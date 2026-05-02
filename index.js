const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('cron');
const { Expo } = require('expo-server-sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/data.json';

app.use(cors());
app.use(express.json());

// Initialize Expo SDK
const expo = new Expo();

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
let db = {
  users: [],
  lastCheck: null,
  availableSlots: []
};

if (fs.existsSync(DB_PATH)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (error) {
    console.log('Error reading database, using default:', error.message);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error('Error saving database:', error.message);
  }
}

// Health check
app.get('/', (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  res.json({ status: 'Tennis Court Monitor API is running', timestamp: new Date().toISOString() });
});

// Register user for notifications
app.post('/register', (req, res) => {
  console.log(`${req.method} ${req.url}`);
  const { pushToken, userId } = req.body;
  
  if (!pushToken || !userId) {
    console.log('Missing pushToken or userId - 400');
    return res.status(400).json({ error: 'pushToken and userId required' });
  }
  
  // Check if user already exists
  const existingUser = db.users.find(u => u.userId === userId);
  if (existingUser) {
    existingUser.pushToken = pushToken;
    existingUser.active = true;
  } else {
    db.users.push({ userId, pushToken, active: true, createdAt: new Date().toISOString() });
  }
  
  saveDB();
  console.log(`User registered: ${userId} - 200`);
  res.json({ success: true, message: 'Registered for notifications' });
});

// Unregister user
app.post('/unregister', (req, res) => {
  console.log(`${req.method} ${req.url}`);
  const { userId } = req.body;
  
  const user = db.users.find(u => u.userId === userId);
  if (user) {
    user.active = false;
    saveDB();
    console.log(`User unregistered: ${userId} - 200`);
    res.json({ success: true, message: 'Unregistered from notifications' });
  } else {
    console.log(`User not found: ${userId} - 404`);
    res.status(404).json({ error: 'User not found' });
  }
});

// Get monitoring status
app.get('/status', (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  res.json({
    isMonitoring: true,
    lastCheck: db.lastCheck,
    availableSlots: db.availableSlots,
    registeredUsers: db.users.filter(u => u.active).length
  });
});

// Mock function to check Alice Marble court availability
// In a real implementation, this would scrape or call the actual SF tennis court reservation system
async function checkCourtAvailability() {
  try {
    console.log('Checking Alice Marble court availability...');
    
    // Mock availability check - replace with actual SF tennis court API/scraping
    const today = new Date();
    const friday = new Date(today);
    friday.setDate(today.getDate() + (5 - today.getDay()) % 7);
    
    // Simulate checking for Friday evening slots (5 PM - 9 PM)
    const mockSlots = [
      { time: '5:00 PM', available: Math.random() > 0.8 },
      { time: '6:00 PM', available: Math.random() > 0.8 },
      { time: '7:00 PM', available: Math.random() > 0.8 },
      { time: '8:00 PM', available: Math.random() > 0.8 }
    ];
    
    const availableSlots = mockSlots.filter(slot => slot.available);
    
    console.log(`Found ${availableSlots.length} available slots`);
    
    // If new slots are available, send notifications
    if (availableSlots.length > 0 && availableSlots.length !== db.availableSlots.length) {
      await sendNotifications(availableSlots);
    }
    
    // Update database
    db.lastCheck = new Date().toISOString();
    db.availableSlots = availableSlots;
    saveDB();
    
    return availableSlots;
  } catch (error) {
    console.error('Error checking court availability:', error.message);
    return [];
  }
}

// Send push notifications to registered users
async function sendNotifications(slots) {
  const activeUsers = db.users.filter(u => u.active);
  
  if (activeUsers.length === 0) {
    console.log('No active users to notify');
    return;
  }
  
  const messages = [];
  
  for (const user of activeUsers) {
    if (!Expo.isExpoPushToken(user.pushToken)) {
      console.log(`Invalid push token for user ${user.userId}`);
      continue;
    }
    
    const slotTimes = slots.map(s => s.time).join(', ');
    
    messages.push({
      to: user.pushToken,
      sound: 'default',
      title: '🎾 Tennis Court Available!',
      body: `Alice Marble court slots open this Friday: ${slotTimes}`,
      data: { slots }
    });
  }
  
  if (messages.length === 0) {
    console.log('No valid push tokens found');
    return;
  }
  
  try {
    const chunks = expo.chunkPushNotifications(messages);
    
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log(`Sent ${ticketChunk.length} notifications`);
    }
  } catch (error) {
    console.error('Error sending notifications:', error.message);
  }
}

// Manual check endpoint for testing
app.post('/check-now', async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  const slots = await checkCourtAvailability();
  console.log('Manual check completed - 200');
  res.json({ success: true, availableSlots: slots });
});

// Set up cron job to check every 10 minutes during business hours
const job = new cron.CronJob('*/10 * * * *', checkCourtAvailability, null, true, 'America/Los_Angeles');
console.log('Scheduled court availability checks every 10 minutes');

app.listen(PORT, () => {
  console.log(`Tennis Court Monitor server running on port ${PORT}`);
  // Run initial check
  setTimeout(checkCourtAvailability, 2000);
});