const socket = io();
const joinCallButton = document.getElementById('joinCall');
const endCallButton = document.getElementById('endCall');
const remoteAudios = document.getElementById('remoteAudios');
const usernameInput = document.getElementById('usernameInput');
const roomscontain = document.querySelector('.room-container');
const userContain = document.querySelector('.user-container');
const userList = document.getElementById('userList'); // Элемент списка для пользователей
const roomList = document.getElementById('roomList');
const mutee = document.getElementById('muteButton');
const Titleroom = document.querySelector('h2.room-name')
let currentRoomId = null;
let isInRoom = false;
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
let roomId = '';

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Создание аудиоэлемента для каждого пользователя
function createAudioElement(userId) {
    const audioContainer = document.createElement('div');
    audioContainer.id = `audio-${userId}`;

    const audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    audioElement.controls = false;
    audioElement.id = `audio-${userId}-stream`;

    audioContainer.appendChild(audioElement);
    remoteAudios.appendChild(audioContainer);
}


// Регулировка громкости
function adjustVolume(userId, volume) {
    const audioElement = document.querySelector(`#audio-${userId} audio` );
    if (audioElement) {
        audioElement.volume = volume; // Устанавливаем громкость аудиоэлемента
        console.log(`Volume for user ${userId} set to ${volume}`);
    }
}

function removeUserFromRoom(userId) {
    const audioContainer = document.getElementById(`user-${userId}`);
    if (audioContainer) {
        audioContainer.remove();
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
        const info = document.createElement('div');
        info.style.zIndex = "2"; 
        info.style.padding = "1em"; 
		info.style.height = "100%";

        // Создаем индикатор активности
        const name = document.createElement('div');
        name.innerHTML = 'Username:'
        const name2 = document.createElement('div');
        name2.innerHTML = user.username;
        const indicator = document.createElement('div');
        indicator.className = 'mic-indicator';
        indicator.id = `indicator-${user.id}`; // Уникальный ID для индикатора
        indicator.style.backgroundColor = '#494949'; // Начальный цвет
        indicator.style.display = 'block'; // Отображение в одной строке с именем
        
        // Создаем регулятор громкости
        const slidercontainer = document.createElement('div');
        slidercontainer.innerHTML = 'Volume:'
		
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
        info.appendChild(name);
        info.appendChild(name2)
        slidercontainer.appendChild(volumeSlider);
        info.appendChild(slidercontainer)
        li.appendChild(info)
        li.appendChild(indicator)
        userList.appendChild(li);
    });
}

async function joinCalll() {
    const username = usernameInput.value;
    roomId = roomIdInput.value;
    if (!roomscontain.classList.contains('hide') && username) {
        roomscontain.classList.add('hide')
    }
    
    if (!username || !roomId) {
        alert("Please enter your name and Room ID.");
        return;
    }

    isInRoom = true;
    joinCallButton.disabled = true;
    endCallButton.disabled = false;
    mutee.disabled = false;
    Titleroom.textContent = `List of connected users in the room: ${roomId}`

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

    // Создаем анализатор
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 4096; // Увеличиваем размер FFT для более точного анализа
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    sourceNode.connect(analyser);

    const gainNode = audioContext.createGain(); // Используем узел для изменения громкости
    gainNode.gain.value = 1; // Устанавливаем начальное значение громкости

    analyser.connect(gainNode);

    // Фильтр низких частот для удаления гула и вибраций
    const highpassFilter = audioContext.createBiquadFilter();
    highpassFilter.type = 'highpass';
    highpassFilter.frequency.value = 1000; // Убираем звуки ниже 150 Гц

    // Фильтр полосы пропускания для голосовых частот (убираем шумы клавиатуры)
    const bandpassFilter = audioContext.createBiquadFilter();
    bandpassFilter.type = 'bandpass';
    bandpassFilter.frequency.value = 1000; // Пропускаем средние частоты
    bandpassFilter.Q.value = 2.0;

    // Фильтр высоких частот для подавления белого шума
    const lowpassFilter = audioContext.createBiquadFilter();
    lowpassFilter.frequency.setValueAtTime(1000, audioContext.currentTime); // Частота среза
    lowpassFilter.Q.setValueAtTime(1, audioContext.currentTime); // Добротность фильтра

    // Компрессор для динамической регулировки громкости (снижает громкость слишком громких и слишком тихих звуков)
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-70, audioContext.currentTime); // Порог срабатывания
    compressor.knee.setValueAtTime(40, audioContext.currentTime); // Мягкость перехода
    compressor.ratio.setValueAtTime(20, audioContext.currentTime); // Степень компрессии
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
                if (volume < 0.8) {  // Порог адаптивного шумоподавления
                    outputData[sample] = 0;
                } else {
                    outputData[sample] = inputData[sample];
                }
            }
        }
    };

    // Подключаем фильтры и процессоры последовательно
    gainNode.connect(highpassFilter);
    highpassFilter.connect(bandpassFilter);
    bandpassFilter.connect(lowpassFilter);
    lowpassFilter.connect(noiseGate);
    noiseGate.connect(compressor);

    // Создаем поток для отправки через WebRTC
    const destination = audioContext.createMediaStreamDestination();
    compressor.connect(destination);

    // Используем обработанный поток
    const processedStream = destination.stream;

    analyzeMicActivity(analyser, gainNode, dataArray);

    peerConnections = {};
    iceCandidatesQueue = {};
    userMutedStatus[socket.id] = false; // По умолчанию не замучен
    userVolume[socket.id] = 1; // Громкость по умолчанию

    // Передаем обработанный аудиопоток для других пользователей
    socket.emit('join-room', roomId, username);
    currentRoomId = roomId;

    const currentJoinButton = document.getElementById(`join-${roomId}`);

    if (currentJoinButton) {
        currentJoinButton.disabled = true;
    }

    socket.on('update-user-list', (users) => {
        updateUserList(users, currentRoomId); // Обновляем список пользователей на клиенте
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
         // Удаляем аудио-элемент при отключении пользователя
        if (peerConnections[userId]) {
            peerConnections[userId].close();
            delete peerConnections[userId];
			removeAudioElement(userId);
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
        const userElement = document.getElementById(`indicator-${userId}`).previousElementSibling.firstChild.nextSibling; // Получаем элемент пользователя по ID
        if (userElement) {
            userElement.classList.toggle('muted', isMuted);
            userElement.textContent = isMuted ? `${userElement.textContent.replace(' (Muted)', '')} (Muted)` : userElement.textContent.replace(' (Muted)', '');
        }
    });
    // Запрос на получение списка пользователей
    socket.emit('request-user-list');
}

function analyzeMicActivity(analyser, gainNode, dataArray) {
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const value = dataArray[i] - 128;
        sum += (value * value);
    }

    const volume = Math.sqrt(sum / dataArray.length);
    const sensitivityMultiplier = 5;

    // Если громкость превышает определённый порог, уменьшаем громкость
    if (volume * sensitivityMultiplier > 0.3) { // Порог для нажатий клавиш и щелчков
        gainNode.gain.value = 0.5; // Уменьшаем громкость, когда обнаружены щелчки
    } else {
        gainNode.gain.value = 1; // Восстанавливаем нормальную громкость
    }

    // Отправляем уровень активности микрофона на сервер
    socket.emit('mic-activity', { volume: volume * sensitivityMultiplier, roomId });

    // Повторяем анализ через небольшой интервал
    requestAnimationFrame(() => analyzeMicActivity(analyser, gainNode, dataArray));
}
function analyzeMicActivity(analyser, gainNode, dataArray) {
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const value = dataArray[i] - 128;
        sum += (value * value);
    }

    const volume = Math.sqrt(sum / dataArray.length);
    const sensitivityMultiplier = 5;

    // Если громкость превышает определённый порог, уменьшаем громкость
    if (volume * sensitivityMultiplier > 0.05) { // Порог для нажатий клавиш и щелчков
        gainNode.gain.value = 0.5; // Уменьшаем громкость, когда обнаружены щелчки
    } else {
        gainNode.gain.value = 1; // Восстанавливаем нормальную громкость
    }

    // Отправляем уровень активности микрофона на сервер
    socket.emit('mic-activity', { volume: volume * sensitivityMultiplier, roomId });

    // Повторяем анализ через небольшой интервал
    requestAnimationFrame(() => analyzeMicActivity(analyser, gainNode, dataArray));
}

function updateMicActivity(userId, volume) {
    const indicator = document.getElementById(`indicator-${userId}`);
    if (indicator) {
        
        const shadowBlur = Math.min(volume * 1, 50);  // Чем больше volume, тем больше размытие тени
        const shadowOpacity = Math.min(volume / 150, 0.6); // Прозрачность тени зависит от громкости

        // Применяем тень вокруг индикатора
        indicator.style.boxShadow = `0 0 ${shadowBlur}px rgba(0, 255, 0, ${shadowOpacity})`;

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

function endCall() {
    joinCallButton.disabled = false;
    endCallButton.disabled = true;
    mutee.disabled = true;
    currentRoomId = null;
    isInRoom = false

    // Убираем экран с комнатами, если он скрыт
    if (roomscontain.classList.contains('hide')) {
        roomscontain.classList.remove('hide')
    }

    const currentJoinButton = document.getElementById(`join-${roomId}`);
    if (currentJoinButton) {
        currentJoinButton.disabled = false;
    }

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
    socket.on('update-user-list', (users) => {
        updateUserList(users); // Обновляем список пользователей на клиенте
    });
    iceCandidatesQueue = {};

    // Очищаем контейнер от всех аудио-элементов
    remoteAudios.innerHTML = '';
    userList.innerHTML = '';
    Titleroom.textContent = '';

    socket.off('user-connected');
    socket.off('user-disconnected');
    socket.off('update-user-list');
    socket.off('update-mic-activity');
}

joinCallButton.onclick = joinCalll;
endCallButton.onclick = endCall;


socket.on('update-room-list', (rooms) => {
    roomList.innerHTML = ''; // Очищаем список комнат

    rooms.forEach((room) => {
        const li = document.createElement('li');
        

        // Добавляем кнопку для подключения к комнате
        const joinButton = document.createElement('button');
        const textt =  document.createElement('div');
        textt.textContent = `Name room: ${room}`;
        joinButton.textContent = 'Join';
        joinButton.id = `join-${room}`;

        if (currentRoomId === room) {
            joinButton.disabled = true;
        }

        joinButton.onclick = () => {
            roomId = room;  // Устанавливаем ID выбранной комнаты
            roomIdInput.value = room;
            joinCalll();  // Подключаемся к выбранной комнате
        };
        li.appendChild(textt);
        li.appendChild(joinButton);
        roomList.appendChild(li);
    });
});

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
    if (usernameInput.value.length > 25) {
        usernameInput.value = usernameInput.value.slice(0, 25); // Ограничиваем количество символов до 10
    }
});

const roomidin = document.getElementById('roomIdInput')

roomidin.addEventListener('input', () => {
    if (roomidin.value.length > 25) {
        roomidin.value = roomidin.value.slice(0, 25); // Ограничиваем количество символов до 10
    }
});