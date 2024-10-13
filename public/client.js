const socket = io();
const joinCallButton = document.getElementById('joinCall');
const endCallButton = document.getElementById('endCall');
const remoteAudios = document.getElementById('remoteAudios');
const usernameInput = document.getElementById('usernameInput');
const userList = document.getElementById('userList'); // Элемент списка для пользователей
let localStream;
let peerConnections = {};
let iceCandidatesQueue = {};
let remoteStreams = {};
let userMutedStatus = {};
let userVolume = {}; // Сохраняем статус мутации каждого пользователя
let audioContext;
let denoiser;
let analyser;
let dataArray;
let roomId = 'default-room';

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};
function initAudioAnalyzer(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;

    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);

    // Запускаем анализ активности микрофона
    analyzeMicActivity();
}
function analyzeMicActivity() {
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const value = dataArray[i] - 128;
        sum += (value * value);
    }

    const volume = Math.sqrt(sum / dataArray.length);
    const sensitivityMultiplier = 2;

    // Отправляем уровень активности микрофона на сервер
    socket.emit('mic-activity', { volume: volume*sensitivityMultiplier, roomId });

    // Повторяем анализ через небольшой интервал
    requestAnimationFrame(analyzeMicActivity);
}

function removeUserFromRoom(userId) {
    const audioContainer = document.getElementById(`user-${userId}`);
    if (audioContainer) {
        audioContainer.remove();
    }
}
function updateMicActivity(userId, volume) {
    const indicator = document.getElementById(`indicator-${userId}`);
    if (indicator) {
        // Меняем цвет и размер индикатора в зависимости от громкости
        const greenValue = Math.min(255, volume * 2); // Нормируем до 255
        indicator.style.backgroundColor = `rgb(0, ${greenValue}, 0)`;
        indicator.style.transform = `scale(${1 + volume / 200});`; // Увеличиваем размер
    }
}

// Функция для создания RTCPeerConnection
function createPeerConnection(peerId, username) {
    const peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: peerId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = (event) => {
        // Проверяем, есть ли уже аудио-элемент для данного пользователя
        if (!document.getElementById(`audio-${peerId}`)) {
            const audioContainer = document.createElement('div');
            audioContainer.className = 'audio-container';
            audioContainer.id = `audio-${peerId}`;

            const audioElement = document.createElement('audio');
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = true;
            audioElement.controls = true;

            const usernameLabel = document.createElement('span');
            usernameLabel.className = 'username';
            usernameLabel.textContent = username;

            audioContainer.appendChild(usernameLabel);
            audioContainer.appendChild(audioElement);
            remoteAudios.appendChild(audioContainer);

            audioElement.addEventListener('ended', () => {
                removeAudioElement(peerId);
            });
        }
    };

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    return peerConnection;
}

// Функция для удаления аудио элемента
function removeAudioElement(peerId) {
    const audioContainer = document.getElementById(`audio-${peerId}`);
    if (audioContainer) {
        audioContainer.remove();
        console.log(`Removed audio element for user ${peerId}`);
    }
}

// Функция для обработки сохранённых ICE-кандидатов
async function processIceCandidates(peerId) {
    if (iceCandidatesQueue[peerId] && peerConnections[peerId] && peerConnections[peerId].remoteDescription) {
        for (let candidate of iceCandidatesQueue[peerId]) {
            try {
                await peerConnections[peerId].addIceCandidate(candidate);
            } catch (e) {
                console.error('Error adding received ice candidate', e);
            }
        }
        delete iceCandidatesQueue[peerId]; // Очищаем очередь
    }
}

// Функция для обновления списка пользователей
function updateUserList(users) {
    userList.innerHTML = ''; // Очищаем список
    users.forEach(user => {

        if (user.id === socket.id) {
            return;
        }
        const li = document.createElement('li');

        // Создаем индикатор активности
        const name = document.createElement('div');
        name.textContent = user.username;
        const indicator = document.createElement('div');
        indicator.className = 'mic-indicator';
        indicator.id = `indicator-${user.id}`; // Уникальный ID для индикатора
        indicator.style.width = '20px';
        indicator.style.height = '20px';
        indicator.style.borderRadius = '50%';
        indicator.style.backgroundColor = 'white'; // Начальный цвет
        indicator.style.display = 'inline-block'; // Отображение в одной строке с именем
        
        // Создаем регулятор громкости
        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.min = 0; // Минимальная громкость
        volumeSlider.max = 1; // Максимальная громкость
        volumeSlider.step = 0.01; // Шаг изменения громкости
        volumeSlider.value = userVolume[user.id] || 1; // Устанавливаем громкость по умолчанию

        // Обработчик события изменения громкости
        volumeSlider.oninput = () => {
            userVolume[user.id] = volumeSlider.value;
            adjustVolume(user.id, userVolume[user.id]);
        };

        // Добавляем индикатор к элементу списка
        li.appendChild(name);
        li.appendChild(volumeSlider);
        li.appendChild(indicator)
        userList.appendChild(li);
    });
}

function adjustVolume(userId, volume) {
    const audioElement = document.querySelector(`#audio-${userId} audio` );
    if (audioElement) {
        audioElement.volume = volume; // Устанавливаем громкость аудиоэлемента
        console.log(`Volume for user ${userId} set to ${volume}`);
    }
}

joinCallButton.onclick = async () => {
    const username = usernameInput.value;
    if (!username) {
        alert("Please enter your name.");
        return;
    }

    joinCallButton.disabled = true;
    endCallButton.disabled = false;

    localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: 5,
            autoGainControl: true,
            sampleRate: 48000
        }
    });

    // Создаем аудиоконтекст для обработки потока
    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(localStream);

    // Фильтр низких частот для удаления гула и вибраций
    const highpassFilter = audioContext.createBiquadFilter();
    highpassFilter.type = 'highpass';
    highpassFilter.frequency.value = 150; // Убираем звуки ниже 150 Гц

    // Фильтр полосы пропускания для голосовых частот (убираем шумы клавиатуры)
    const bandpassFilter = audioContext.createBiquadFilter();
    bandpassFilter.type = 'bandpass';
    bandpassFilter.frequency.value = 1000; // Пропускаем средние частоты
    bandpassFilter.Q.value = 1.0;

    // Фильтр высоких частот для подавления белого шума
    const lowpassFilter = audioContext.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.value = 3000; // Отсекаем частоты выше 3 кГц

    // Компрессор для динамической регулировки громкости (снижает громкость слишком громких и слишком тихих звуков)
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-50, audioContext.currentTime); // Порог срабатывания
    compressor.knee.setValueAtTime(40, audioContext.currentTime); // Мягкость перехода
    compressor.ratio.setValueAtTime(12, audioContext.currentTime); // Степень компрессии
    compressor.attack.setValueAtTime(0, audioContext.currentTime); // Скорость срабатывания
    compressor.release.setValueAtTime(0.25, audioContext.currentTime); // Время восстановления

    // Шумоподавляющий процессор с адаптивным порогом
    const noiseGate = audioContext.createScriptProcessor(4096, 1, 1);
    noiseGate.onaudioprocess = (audioProcessingEvent) => {
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const outputBuffer = audioProcessingEvent.outputBuffer;

        for (let channel = 0; channel < inputBuffer.numberOfChannels; channel++) {
            const inputData = inputBuffer.getChannelData(channel);
            const outputData = outputBuffer.getChannelData(channel);

            for (let sample = 0; sample < inputBuffer.length; sample++) {
                // Анализируем уровень громкости
                const volume = Math.abs(inputData[sample]);
                
                // Подавляем звуки, которые слишком тихие
                if (volume < 0.01) {  // Порог адаптивного шумоподавления
                    outputData[sample] = 0;
                } else {
                    outputData[sample] = inputData[sample];
                }
            }
        }
    };

    // Подключаем фильтры и процессоры последовательно
    sourceNode.connect(highpassFilter);
    highpassFilter.connect(bandpassFilter);
    bandpassFilter.connect(lowpassFilter);
    lowpassFilter.connect(noiseGate);
    noiseGate.connect(compressor);

    // Создаем поток для отправки через WebRTC
    const destination = audioContext.createMediaStreamDestination();
    compressor.connect(destination);

    // Используем обработанный поток
    const processedStream = destination.stream;

    initAudioAnalyzer(localStream);

    peerConnections = {};
    iceCandidatesQueue = {};
    userMutedStatus[socket.id] = false; // По умолчанию не замучен
    userVolume[socket.id] = 1; // Громкость по умолчанию

    // Передаем обработанный аудиопоток для других пользователей
    socket.emit('join-room', roomId, username);

    socket.on('update-user-list', (users) => {
        updateUserList(users); // Обновляем список пользователей на клиенте
    });

    socket.on('user-connected', async (userId, username) => {
        console.log('User connected:', userId);
        const peerConnection = createPeerConnection(userId, username);
        peerConnections[userId] = peerConnection;

        // Добавляем обработанный аудиопоток в соединение
        processedStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, processedStream);
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            target: userId,
            sdp: peerConnection.localDescription
        });
    });

    socket.on('user-disconnected', (userId) => {
        console.log(`User disconnected: ${userId}`);
        removeUserFromRoom(userId);
        if (peerConnections[userId]) {
            peerConnections[userId].close();
            delete peerConnections[userId];
            removeAudioElement(userId); // Удаляем аудио-элемент при отключении пользователя
        }
    });
    socket.on('update-mic-activity', (userId, volume) => {
        updateMicActivity(userId, volume);
    });

    // Логика для кнопки Mute
    const muteButton = document.getElementById('muteButton');
    let isMuted = false;

    muteButton.onclick = () => {
        isMuted = !isMuted;

        // Отправляем статус мутации на сервер, чтобы другие клиенты знали, что пользователь замучен
        socket.emit('mute-user', { userId: socket.id, isMuted });

        muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
    };

    // Обработка статуса мутации для других пользователей
    socket.on('user-muted', ({ userId, isMuted }) => {
        console.log(`User ${userId} is ${isMuted ? 'muted' : 'unmuted'}`);

        // Находим аудиоэлемент для пользователя
        const audioElement = document.querySelector(`#audio-${userId} audio`);
        if (audioElement) {
            audioElement.muted = isMuted; // Отключаем/включаем звук
            console.log(`Audio for user ${userId} is now ${isMuted ? 'muted' : 'unmuted'}`);
        }

        // Обновляем визуальный статус мутации
        const userElement = document.getElementById(`indicator-${userId}`).previousElementSibling.previousElementSibling; // Получаем элемент пользователя по ID
        if (userElement) {
            userElement.classList.toggle('muted', isMuted);
            userElement.textContent = isMuted ? `${userElement.textContent.replace(' (Muted)', '')} (Muted)` : userElement.textContent.replace(' (Muted)', '');
        }
    });
    // Запрос на получение списка пользователей
    socket.emit('request-user-list');

    
};

// Когда сервер отправляет обновленный список пользователей
socket.on('update-user-list', (users) => {
    console.log('Received user list:', users);
    updateUserList(users);
});

endCallButton.onclick = () => {
    joinCallButton.disabled = false;
    endCallButton.disabled = true;

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    // Закрываем все соединения и удаляем аудио-элементы
    for (let peerId in peerConnections) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
        removeAudioElement(peerId); // Удаляем все аудио-элементы
    }

    socket.emit('leave-room', roomId);

    iceCandidatesQueue = {};

    // Очищаем контейнер от всех аудио-элементов
    remoteAudios.innerHTML = '';

    socket.emit('leave-room', roomId);
};

socket.on('offer', async (data) => {
    const { sdp, sender, username } = data;

    if (!peerConnections[sender]) {
        const peerConnection = createPeerConnection(sender, username);
        peerConnections[sender] = peerConnection;
    }

    const peerConnection = peerConnections[sender];

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answer', {
            target: sender,
            sdp: peerConnection.localDescription
        });

        // Применяем все отложенные ICE-кандидаты
        await processIceCandidates(sender);
    } catch (error) {
        console.error("Error handling offer:", error);
    }
});


socket.on('answer', async (data) => {
    const { sdp, sender } = data;

    if (!peerConnections[sender]) {
        console.error(`Peer connection for ${sender} not found when handling answer.`);
        return;
    }

    const peerConnection = peerConnections[sender];

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        // Применяем все отложенные ICE-кандидаты
        await processIceCandidates(sender);
    } catch (error) {
        console.error("Error handling answer:", error);
    }
});


socket.on('ice-candidate', async (data) => {
    const { candidate, sender } = data;

    if (!peerConnections[sender]) {
        console.error(`Peer connection for ${sender} not found when handling ICE candidate.`);
        return;
    }

    const peerConnection = peerConnections[sender];

    // Создаем RTCIceCandidate, если candidate не пустая строка
    let iceCandidate;
    if (candidate.candidate !== "") {
        iceCandidate = new RTCIceCandidate(candidate);
    } else {
        console.log(`End of candidates for ${sender}`);
        iceCandidate = null; // Обрабатываем это как конец ICE-кандидатов
    }

    // Определяем, используется ли ufrag для сопоставления с медиа-описанием и ICE поколением
    if (candidate.ufrag) {
        console.log(`Processing candidate with ufrag: ${candidate.ufrag}`);
        // Дополнительная логика для обработки ufrag может быть добавлена здесь.
        // Обычно это применяется для того, чтобы идентифицировать правильное медиа-описание и поколение ICE.
    } else {
        console.log("Processing candidate with most recent ICE generation and media description.");
        // Если ufrag не указан, обрабатываем кандидата для последнего ICE поколения и медиа-описания.
    }

    try {
        if (iceCandidate) {
            // Если удаленное описание уже установлено, добавляем кандидата
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(iceCandidate);
            } else {
                // Если удаленное описание еще не установлено, сохраняем кандидата
                if (!iceCandidatesQueue[sender]) {
                    iceCandidatesQueue[sender] = [];
                }
                iceCandidatesQueue[sender].push(iceCandidate);
            }
        } else {
            console.log(`No more ICE candidates for ${sender}`);
            // Логика для обработки конца кандидатов (например, "end-of-candidates" сигнал)
            // можно вызвать функцию для завершения ICE кандидатов для конкретного sender
        }
    } catch (e) {
        console.error('Error processing ICE candidate:', e);
    }
});

usernameInput.addEventListener('input', () => {
    if (usernameInput.value.length > 15) {
        usernameInput.value = usernameInput.value.slice(0, 15); // Ограничиваем количество символов до 10
    }
});