const express = require('express');
const mqtt = require('mqtt');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql');
const bcrypt = require('bcrypt');

// MQTT credentials
const mqtt_url = 'mqtt://05399b96ecd0479383f3a364f0cc4552.s1.eu.hivemq.cloud:8883';
const mqtt_username = 'testuser';
const mqtt_password = 'Test1234';

// Create Express app
const app = express();
let port = 4001; // Initial port

// Use middlewares
app.use(cors());
app.use(bodyParser.json());

// MQTT connection options
const mqtt_options = {
  username: mqtt_username,
  password: mqtt_password,
  port: 8883,
  protocol: 'mqtts',
  rejectUnauthorized: false
};

// Create MQTT client
const client = mqtt.connect(mqtt_url, mqtt_options);

// Variable to store the latest MAC address and timestamp
let latestMacAddress = '';
let lastMessageTime = {};

// MQTT connection
client.on('connect', () => {
  console.log('Connected to MQTT broker');
  client.subscribe('device_ping', (err) => {
    if (!err) {
      console.log('Subscribed to device_ping');
    } else {
      console.error('Failed to subscribe: ', err);
    }
  });
});

client.on('error', (err) => {
  console.error('MQTT connection error:', err);
});

// Create connection to MySQL database
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root', // use your MySQL username
  password: 'eren23', // use your MySQL password
  database: 'flutter_auth'
});

// Connect to the database
db.connect((err) => {
  if (err) {
    throw err;
  }
  console.log('MySQL Connected...');
});

// Handle incoming MQTT messages
client.on('message', (topic, message) => {
  if (topic === 'device_ping') {
    latestMacAddress = message.toString();
    const currentTime = Date.now();

    console.log(`Received MAC address on ${topic}: ${latestMacAddress}`);

    lastMessageTime[latestMacAddress] = currentTime;

    const sqlCheck = 'SELECT * FROM devices WHERE device_name = ?';
    db.query(sqlCheck, [latestMacAddress], (err, result) => {
      if (err) {
        console.error('Database query error:', err);
        return;
      }

      if (result.length > 0) {
        // Entry exists, update the status to on
        const sqlUpdateOn = 'UPDATE devices SET status = ? WHERE device_name = ?';
        db.query(sqlUpdateOn, ['on', latestMacAddress], (err, updateResult) => {
          if (err) {
            console.error('Failed to update status to on:', err);
            return;
          }
          console.log(`Updated status to on for device: ${latestMacAddress}`);
        });
      } else {
        // Entry does not exist, create a new entry
        const sqlInsert = 'INSERT INTO devices (device_name, status) VALUES (?, ?)';
        db.query(sqlInsert, [latestMacAddress, 'on'], (err, insertResult) => {
          if (err) {
            console.error('Failed to insert new device:', err);
            return;
          }
          console.log(`Inserted new device: ${latestMacAddress}`);
        });
      }
    });
  }
});

// Check for inactive devices
setInterval(() => {
  const currentTime = Date.now();
  for (const mac in lastMessageTime) {
    if ((currentTime - lastMessageTime[mac]) > 30000) {
      const sqlUpdateOff = 'UPDATE devices SET status = ? WHERE device_name = ?';
      db.query(sqlUpdateOff, ['off', mac], (err, updateResult) => {
        if (err) {
          console.error('Failed to update status to off:', err);
          return;
        }
        console.log(`Status set to off for device: ${mac} due to inactivity`);
        delete lastMessageTime[mac];
      });
    }
  }
}, 10000); // Check every 10 seconds

// Endpoint to publish a message to the latest MAC topic
app.post('/publish', (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).send('Message is required.');
  }

  if (!latestMacAddress) {
    return res.status(400).send('No MAC address available. Ensure the ESP32 is sending its MAC address.');
  }

  const macTopic = `${latestMacAddress}_ping`;

  client.publish(macTopic, message, (err) => {
    if (err) {
      console.error('Failed to publish:', err);
      return res.status(500).send('Failed to publish message.');
    } else {
      console.log(`Published message to ${macTopic}`);
      return res.status(200).send(`Message published to ${macTopic}`);
    }
  });
});

// Register user
app.post('/register', (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  const confirmPassword = req.body.confirmPassword;

  if (password !== confirmPassword) {
    return res.status(400).send('Passwords do not match');
  }

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      return res.status(500).send('Server error');
    }

    const sql = 'INSERT INTO users (email, password) VALUES (?, ?)';
    db.query(sql, [email, hash], (err, result) => {
      if (err) {
        return res.status(500).send('Server error');
      }
      res.status(200).send('User registered');
    });
  });
});

// Login user
app.post('/login', (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  const sql = 'SELECT * FROM users WHERE email = ?';
  db.query(sql, [email], (err, result) => {
    if (err) {
      return res.status(500).send('Server error');
    }

    if (result.length === 0) {
      return res.status(400).send('User not found');
    }

    const user = result[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        return res.status(500).send('Server error');
      }

      if (!isMatch) {
        return res.status(400).send('Invalid credentials');
      }

      res.status(200).send('User logged in');
    });
  });
});

// Start Express server
let server;
function startServer() {
  server = app.listen(port, () => {
    console.log(`Express server running at http://localhost:${port}`);
  });

  // Error handling for port in use
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying another port...`);
      port++;
      startServer();
    } else {
      console.error(err);
    }
  });
}

startServer();
