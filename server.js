require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const db = require("./db");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

let chatRooms = {};
let users = {};

// Utilities
const sanitizeMessage = (message) =>
  message?.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "";

// Fetch university names and create chat rooms
async function initializeChatRooms() {
  try {
    const [rows] = await db.query("SELECT id, name FROM school_data;");
    chatRooms["room_global"] = "Global";
    rows.forEach((row) => {
      const roomName = `room_${row.name.replace(/\s+/g, "_").toLowerCase()}`;
      chatRooms[roomName] = row.name;
    });
    console.log(
      `✅ Chat rooms initialized: ${Object.keys(chatRooms).length} rooms`
    );
  } catch (error) {
    console.error("❌ Error fetching school data:", error);
  }
}

// Initialize chat rooms at startup
initializeChatRooms();

// Socket.IO logic
io.on("connection", (socket) => {
  console.log(`🔗 User connected: ${socket.id}`);

  // Handle joining a room
  socket.on("joinRoom", ({ room, username }) => {
    if (!room || !username) {
      socket.emit("error", "Room or Username is missing.");
      return;
    }

    if (chatRooms[room]) {
      socket.join(room);
      users[socket.id] = { username, room };
      socket.to(room).emit("notification", `${username} has joined the room.`);
      console.log(`✅ ${username} joined ${room}`);
      io.emit("users", users);
    } else {
      socket.emit("error", "Room does not exist.");
    }
  });

  // Handle leaving a room
  socket.on("leaveRoom", () => {
    const user = users[socket.id];
    if (user) {
      const { room, username } = user;
      socket.leave(room);
      io.to(room).emit("notification", `${username} has left the room.`);
      console.log(`❌ ${username} left ${room}`);
      io.emit("users", users);
    }
  });
  // Handle group messages
  socket.on("sendMessage", ({ room, message }) => {
    const sanitizedContent = sanitizeMessage(message?.content);
    if (chatRooms[room]) {
      socket.to(room).emit("message", {
        sender: message?.username || "Unknown",
        message: sanitizedContent,
      });
    }
  });

  // Handle private messaging
  socket.on("privateMessage", ({ to, message }) => {
    const sanitizedContent = sanitizeMessage(message?.content);
    const user = Object.keys(users).find((key) => users[key].username === to);
    if (user) {
      io.to(user).emit("privateMessage", {
        sender: message?.username || "Unknown",
        message: sanitizedContent,
      });
    } else {
      socket.emit("error", "User not found.");
    }
  });

  // Handle fetching list of users
  socket.on("getUsers", () => {
    socket.emit("users", users);
  });

  const handleDisconnectingUser = (user) => {
    if (user) {
      const { room, username } = user;
      socket.leave(room);
      delete users[socket.id];
      io.to(room).emit("notification", `${username} has left the room.`);
      console.log(`❌ ${username} left ${room}`);
      io.emit("users", users);
    }
  };

  // Handle leaving the page
  socket.on("leavePage", () => {
    const user = users[socket.id];
    handleDisconnectingUser(user);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const user = users[socket.id];
    handleDisconnectingUser(user);
  });
});

// API endpoint to get chat rooms
app.get("/api/rooms", (req, res) => {
  res.json(chatRooms);
});

// Serve chat_app.html file
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/chat_app.html");
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
