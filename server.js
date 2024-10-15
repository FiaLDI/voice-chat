const fs = require('fs');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet');

const app = express();

// https свой сертификат
const server = https.createServer({
    key: fs.readFileSync('keys/key.pem'),
    cert: fs.readFileSync('keys/cert.pem')
}, app);

const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'none'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
            },
        },
    })
);

const usersInRoom = {};
const rooms = {};  // Список всех активных комнат
const messages = JSON.parse(fs.readFileSync('messages.json', { encoding: 'utf8', flag: 'r' }));

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.emit('update-room-list', Object.keys(rooms));

    socket.on('join-room', (roomId, username) => {
        console.log(`User ${socket.id} (username: ${username}) joined room: ${roomId}`);
        
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = roomId; // Добавляем комнату в список
            io.emit('update-room-list', Object.keys(rooms)); // Отправляем обновленный список всем пользователям
        }
		
        if (!usersInRoom[roomId]) {
            usersInRoom[roomId] = [];
        }
        
        usersInRoom[roomId].push({ id: socket.id, username });
        io.to(roomId).emit('update-user-list', usersInRoom[roomId]);

        socket.broadcast.to(roomId).emit('user-connected', socket.id, username);

        socket.on('offer', (data) => {
            socket.to(data.target).emit('offer', { sdp: data.sdp, sender: socket.id, username });
        });

        socket.on('answer', (data) => {
            socket.to(data.target).emit('answer', { sdp: data.sdp, sender: socket.id });
        });

        socket.on('ice-candidate', (data) => {
            socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
        });

        socket.on('leave-room', () => {
            handleUserDisconnect(socket, roomId);
        });

        socket.on('mic-activity', ({ volume }) => {
            // Рассылаем информацию о громкости всем пользователям в комнате
            socket.broadcast.to(roomId).emit('update-mic-activity', socket.id, volume);
        });

        socket.on('mute-user', ({ userId, isMuted }) => {
            // Уведомляем всех пользователей, кроме отправителя
            socket.broadcast.emit('user-muted', { userId, isMuted });
        });

        // Обработка отключения пользователя
        socket.on('disconnect', () => {
            handleUserDisconnect(socket, roomId);
        });
    });
    function handleUserDisconnect(socket, roomId) {
        console.log(`User ${socket.id} disconnected or left room: ${roomId}`);

        // Удаляем пользователя из комнаты
        if (usersInRoom[roomId]) {
            usersInRoom[roomId] = usersInRoom[roomId].filter(user => user.id !== socket.id);

            // Если в комнате больше нет пользователей, удаляем комнату
            if (usersInRoom[roomId].length === 0) {
                delete usersInRoom[roomId];
                delete rooms[roomId]; // Удаляем комнату из списка
                io.emit('update-room-list', Object.keys(rooms)); // Обновляем список комнат для всех
            }
        }

        // Обновляем список пользователей и отправляем его всем в комнате
        io.to(roomId).emit('update-user-list', usersInRoom[roomId] || []);

        // Уведомляем остальных участников о том, что пользователь отключился
        socket.broadcast.to(roomId).emit('user-disconnected', socket.id);
    }
    // Отправка всех ранее сохраненных сообщений клиенту
    socket.emit('previous-messages', messages);

    socket.on('chat-message', ({ roomId, message, username, time }) => {
        // Сохраняем сообщение в массив
        const chatMessage = { username, message, time};
        messages.push(chatMessage);

        // Сохраняем сообщения в файл JSON
        fs.writeFileSync('messages.json', JSON.stringify(messages, null, 2));

        // Отправляем сообщение всем участникам
        io.emit('chat-message', chatMessage);
    });
});

server.listen(3000, () => {
    console.log('Server is running on https://localhost:3000');
});
