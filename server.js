require("dotenv").config();
const express = require("express");
const https = require("https");
const http = require("http");
const fs = require("fs");
const { Server } = require("socket.io");
const db = require("./db");
const cors = require("cors");

const isProduction = process.env.IS_PRODUCTION === "true";

console.log(
  !isProduction ? "Running in local mode" : "Running in production mode"
);

const sslOptions = {
  key: "",
  cert: "",
};

if (isProduction) {
  sslOptions.key = fs.readFileSync(
    "/etc/letsencrypt/live/chat.lumipixel.io/privkey.pem"
  );
  sslOptions.cert = fs.readFileSync(
    "/etc/letsencrypt/live/chat.lumipixel.io/fullchain.pem"
  );
}

const app = express();
let server = null;
if (isProduction) {
  server = https.createServer(sslOptions, app);
} else {
  server = http.createServer(app);
}
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 443;

// Middleware
app.use(cors());
app.use(express.json());

let chatRooms = {};
let users = {};

// Utilities
const sanitizeMessage = (message) =>
  message?.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "";

// Fetch university names and create chat rooms
async function syncChatRooms() {
  try {
    // Fetch the latest data from the database
    const [rows] = await db.query("SELECT id, name FROM school_data;");
    const currentRooms = {};

    // Create a mapping of the current database state
    rows.forEach((row) => {
      const roomName = `room_${row.name.replace(/\s+/g, "_").toLowerCase()}`;
      currentRooms[roomName] = row.name;
    });

    // Detect New Rooms
    Object.keys(currentRooms).forEach((roomName) => {
      if (!chatRooms[roomName]) {
        console.log(`➕ New room added: "${currentRooms[roomName]}"`);
      }
    });

    // Detect Removed Rooms
    Object.keys(chatRooms).forEach((roomName) => {
      if (!currentRooms[roomName] && roomName !== "room_global") {
        console.log(`❌ Room removed: "${chatRooms[roomName]}"`);
      }
    });

    // Detect Updated Rooms
    Object.keys(chatRooms).forEach((roomName) => {
      if (
        currentRooms[roomName] &&
        chatRooms[roomName] !== currentRooms[roomName]
      ) {
        console.log(
          `✏️ Room updated: "${chatRooms[roomName]}" -> "${currentRooms[roomName]}"`
        );
      }
    });

    // Sync the chatRooms object
    chatRooms = { room_global: "Global", ...currentRooms };

    console.log(
      `✅ Chat rooms synchronized: ${Object.keys(chatRooms).length} rooms`
    );
  } catch (error) {
    console.error("❌ Error synchronizing chat rooms:", error);
  }
}

// Initial sync at startup
syncChatRooms();

// Optional: Periodically sync chat rooms every 5 minutes
setInterval(syncChatRooms, 1 * 60 * 1000);

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
  //  res.sendFile(__dirname + "/chat_app.html");
  res.send("Welcome to LumiPixel Chat API!");
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
