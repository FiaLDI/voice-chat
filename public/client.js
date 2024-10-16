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

// Регулировка громкости
function adjustVolume(userId, volume) {
    const audioElement = document.querySelector(`#audio-${userId} audio` );
    if (audioElement) {
        audioElement.volume = volume; // Устанавливаем громкость аудиоэлемента
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
        volumeSlider.value = userVolume[user.id] || 0.5; // Устанавливаем громкость по умолчанию

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

    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(localStream);
    
    // Создание анализатора для частотного анализа
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Создание многополосных фильтров для человеческой речи
    const bandpassFilterLow = audioContext.createBiquadFilter();
    bandpassFilterLow.type = 'bandpass';
    bandpassFilterLow.frequency.value = 1000; // Низкая частота для человеческой речи
    bandpassFilterLow.Q.value = 10.0; // Увеличенный Q-фактор
    
    const bandpassFilterHigh = audioContext.createBiquadFilter();
    bandpassFilterHigh.type = 'bandpass';
    bandpassFilterHigh.frequency.value = 3000; // Высокая частота для человеческой речи
    bandpassFilterHigh.Q.value = 10.0; // Увеличенный Q-фактор
    
    // Добавление нескольких узких фильтров для подавления механического шума
    const noiseNotchFilters = [];
    const noiseFrequencies = [1500, 2000, 2500, 4000, 4500]; // Частоты для подавления
    
    for (const freq of noiseFrequencies) {
        const notchFilter = audioContext.createBiquadFilter();
        notchFilter.type = 'notch';
        notchFilter.frequency.value = freq;
        notchFilter.Q.value = 80; // Узкий Q для жесткой фильтрации
        noiseNotchFilters.push(notchFilter);
    }
    
    // Создание компрессора для управления динамическим диапазоном
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-40, audioContext.currentTime);
    compressor.knee.setValueAtTime(30, audioContext.currentTime);
    compressor.ratio.setValueAtTime(8, audioContext.currentTime); // Более высокий коэффициент
    compressor.attack.setValueAtTime(0.001, audioContext.currentTime);
    compressor.release.setValueAtTime(0.1, audioContext.currentTime);
    
    // Обработка аудио с помощью скриптового процессора
    const noiseGate = audioContext.createScriptProcessor(4096, 1, 1);
    noiseGate.onaudioprocess = (audioProcessingEvent) => {
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const outputBuffer = audioProcessingEvent.outputBuffer;
    
        for (let channel = 0; channel < inputBuffer.numberOfChannels; channel++) {
            const inputData = inputBuffer.getChannelData(channel);
            const outputData = outputBuffer.getChannelData(channel);
    
            // Анализ аудиоданных для обнаружения активности голоса
            analyser.getByteFrequencyData(dataArray);
            const averageVolume = dataArray.reduce((sum, value) => sum + value) / dataArray.length;
    
            for (let sample = 0; sample < inputBuffer.length; sample++) {
                const volume = Math.abs(inputData[sample]);
    
                // Обнаружение активности голоса и подавление шума
                if (volume < averageVolume * 0.1) { // Более жесткое подавление
                    outputData[sample] = 0; // Подавить звуки, не относящиеся к речи
                } else {
                    outputData[sample] = inputData[sample]; // Позволить человеческую речь
                }
            }
        }
    };
    
    // Соединение узлов в нужном порядке
    sourceNode.connect(bandpassFilterLow);
    bandpassFilterLow.connect(bandpassFilterHigh);
    
    // Подключение всех узких фильтров
    let lastFilter = bandpassFilterHigh;
    for (const notchFilter of noiseNotchFilters) {
        lastFilter.connect(notchFilter);
        lastFilter = notchFilter;
    }
    
    lastFilter.connect(noiseGate);
    noiseGate.connect(compressor);
    
    // Создание выходного потока для обработанного аудио
    const destination = audioContext.createMediaStreamDestination();
    compressor.connect(destination);
    
    // Использование обработанного потока
    const processedStream = destination.stream;

    initAudioAnalyzer(localStream);

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

function initAudioAnalyzer(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;

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
    const sensitivityMultiplier = 5;

    // Отправляем уровень активности микрофона на сервер
    socket.emit('mic-activity', { volume: volume*sensitivityMultiplier, roomId });

    // Повторяем анализ через небольшой интервал
    requestAnimationFrame(analyzeMicActivity);
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
            audioElement.volume = 0.5; 

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