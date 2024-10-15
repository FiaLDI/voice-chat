const chatInput = document.getElementById('chatInput');
const sendChatButton = document.getElementById('sendChatButton');
const imageInput = document.getElementById('imageInput');
const messagesContainer = document.getElementById('messages');

const formatTime = (date) => {
    const hours = date.getHours().toString().padStart(2, '0'); // Получаем часы
    const minutes = date.getMinutes().toString().padStart(2, '0'); // Получаем минуты
    return `${hours}:${minutes}`; // Возвращаем формат "часы:минуты"
};

const scrollToBottom = () => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
};

// Функция для отправки сообщения
const sendMessage = () => {
    const message = chatInput.value.trim() ; // Получаем сообщение из поля ввода
    const username = usernameInput.value.trim() || 'Anonim'; // Получаем имя пользователя

    if (message !== '' && username !== '') { // Проверяем, что оба поля заполнены
        socket.emit('chat-message', { roomId: 'defaultRoom', message, username,time: formatTime(new Date()), }); // Отправляем сообщение на сервер
        chatInput.value = ''; // Очищаем поле ввода
    } 
};

// Обработчик нажатия кнопки "Отправить"
sendChatButton.onclick = sendMessage;

// Обработка нажатия клавиши Enter
chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault(); // Предотвращаем стандартное поведение (перенос строки)
        sendMessage(); // Вызываем функцию для отправки сообщения
    }
});

chatInput.addEventListener('input', () => {
    if (chatInput.value.length > 120) {
        chatInput.value = chatInput.value.slice(0, 120); // Ограничиваем количество символов до 10
    }
});

// Обработка получения сообщения
socket.on('chat-message', ({ username, message, time }) => {
    const messageElement = document.createElement('div');
    messageElement.textContent = `${username}[${time}]: ${message}`; // Форматируем сообщение
    messagesContainer.appendChild(messageElement); // Добавляем сообщение в контейнер
    scrollToBottom();
});

// Обработка предыдущих сообщений
socket.on('previous-messages', (previousMessages) => {
    previousMessages.forEach(({ username, message, time }) => {
        const messageElement = document.createElement('div');
        messageElement.textContent = `${username}[${time}]: ${message}`; // Форматируем сообщение
        messagesContainer.appendChild(messageElement); // Добавляем сообщение в контейнер
    });
    scrollToBottom();
});
