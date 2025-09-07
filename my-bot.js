require("dotenv").config();

const express = require("express");
const app = express();
const port = process.env.PORT || 3000; // Render sets PORT automatically

app.get("/", (req, res) => {
  res.send("Bot is running on Render!");
});

// Health check endpoint for monitoring
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    bot: client.user ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

// Store monitored Instagram usernames
const monitoredUsernames = new Map();
const userSubscriptions = new Map();

// Admin user ID
const ADMIN_ID = process.env.ADMIN_ID;

// Admin log channel ID from environment variables
const ADMIN_LOG_CHANNEL_ID = process.env.ADMIN_LOG_CHANNEL_ID;

// Track processed messages to prevent duplicates
const processedMessages = new Set();

// Add random delay function
function randomDelay(min, max) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.random() * (max - min) + min)
  );
}

// Check if environment variables are set
if (!process.env.DISCORD_TOKEN) {
  console.error("ERROR: DISCORD_TOKEN environment variable is missing!");
  console.error("Please set it in Render environment variables");
  process.exit(1);
}

if (!process.env.ADMIN_LOG_CHANNEL_ID) {
  console.error(
    "WARNING: ADMIN_LOG_CHANNEL_ID environment variable is missing!"
  );
}

// Bot is ready
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Monitoring ${monitoredUsernames.size} Instagram usernames`);

  // Add auto-reconnect logic for Render
  client.on("disconnect", () => {
    console.log("Bot disconnected. Attempting to reconnect...");
    setTimeout(() => {
      client.login(process.env.DISCORD_TOKEN);
    }, 5000);
  });
});

// Handle messages
client.on("messageCreate", async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Prevent duplicate message processing
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);

  // Clean up old processed messages to prevent memory leaks
  if (processedMessages.size > 1000) {
    const oldestMessages = Array.from(processedMessages).slice(0, 100);
    oldestMessages.forEach((id) => processedMessages.delete(id));
  }

  // Check if user has an active subscription
  if (
    !userSubscriptions.has(message.author.id) &&
    message.author.id !== ADMIN_ID
  ) {
    try {
      await message.author.send(
        "You don't have an active subscription. Please contact an admin."
      );
    } catch (error) {
      console.log(`Could not send DM to ${message.author.tag}`);
    }
    return;
  }

  // Check if subscription has expired
  if (userSubscriptions.has(message.author.id)) {
    const subscription = userSubscriptions.get(message.author.id);
    if (
      subscription.expiryDate < Date.now() &&
      message.author.id !== ADMIN_ID
    ) {
      try {
        await message.author.send(
          "Your subscription has expired. Please contact an admin to renew."
        );
      } catch (error) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }
      return;
    }
  }

  // Admin commands
  if (message.author.id === ADMIN_ID) {
    // Add user subscription
    if (message.content.startsWith("!adduser ")) {
      const content = message.content.slice(9).trim();
      const match = content.match(/^<@!?(\d+)>\s+(\w+)$/);

      if (!match) {
        return message.reply(
          "Usage: !adduser @user <duration> (1week, 1month, 1year)"
        );
      }

      const userId = match[1];
      const duration = match[2].toLowerCase();

      let expiryDate;
      switch (duration) {
        case "1week":
          expiryDate = Date.now() + 7 * 24 * 60 * 60 * 1000;
          break;
        case "1month":
          expiryDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
          break;
        case "1year":
          expiryDate = Date.now() + 365 * 24 * 60 * 60 * 1000;
          break;
        default:
          return message.reply(
            "Invalid duration. Use: 1week, 1month, or 1year"
          );
      }

      userSubscriptions.set(userId, {
        expiryDate: expiryDate,
        addedBy: message.author.id,
        addedAt: Date.now(),
      });

      logToAdminChannel(
        `Admin ${
          message.author.tag
        } added subscription for <@${userId}> until ${new Date(
          expiryDate
        ).toLocaleDateString()}`
      );
      message.reply(
        `Added subscription for <@${userId}> until ${new Date(
          expiryDate
        ).toLocaleDateString()}`
      );
    }

    // Remove user subscription
    if (message.content.startsWith("!removeuser ")) {
      const content = message.content.slice(12).trim();
      const match = content.match(/^<@!?(\d+)>$/);

      if (!match) {
        return message.reply("Usage: !removeuser @user");
      }

      const userId = match[1];

      if (userSubscriptions.has(userId)) {
        userSubscriptions.delete(userId);
        logToAdminChannel(
          `Admin ${message.author.tag} removed subscription for <@${userId}>`
        );
        message.reply(`Removed subscription for <@${userId}>`);
      } else {
        message.reply("User doesn't have an active subscription.");
      }
    }

    // List all subscriptions
    if (message.content === "!listsubs") {
      if (userSubscriptions.size === 0) {
        return message.reply("No active subscriptions.");
      }

      let list = "Active Subscriptions:\n";
      for (const [userId, data] of userSubscriptions) {
        const timeLeft = data.expiryDate - Date.now();
        list += `- <@${userId}> (expires in ${formatTime(timeLeft)})\n`;
      }

      message.reply(list);
    }
  }

  // User commands
  if (message.content.startsWith("!watch ")) {
    const username = message.content.slice(7).trim();

    if (!username || username.length < 1) {
      try {
        await message.author.send("Please provide a valid Instagram username");
      } catch (error) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }
      return;
    }

    if (monitoredUsernames.has(username)) {
      const userDataArray = monitoredUsernames.get(username);
      const userAlreadyMonitoring = userDataArray.find(
        (data) => data.userId === message.author.id
      );

      if (userAlreadyMonitoring) {
        try {
          await message.author.send(
            `You're already monitoring the username "${username}"`
          );
        } catch (error) {
          console.log(`Could not send DM to ${message.author.tag}`);
        }
        return;
      }
    }

    let userMonitorCount = 0;
    for (const [, userDataArray] of monitoredUsernames) {
      for (const data of userDataArray) {
        if (data.userId === message.author.id) {
          userMonitorCount++;
        }
      }
    }

    if (userMonitorCount >= 3) {
      try {
        await message.author.send(
          "You can only monitor up to 3 usernames at a time."
        );
      } catch (error) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }
      return;
    }

    const userMonitoringData = {
      startTime: Date.now(),
      userId: message.author.id,
      status: "monitoring",
      lastChecked: Date.now(),
    };

    if (monitoredUsernames.has(username)) {
      const existingData = monitoredUsernames.get(username);
      existingData.push(userMonitoringData);
      monitoredUsernames.set(username, existingData);
    } else {
      monitoredUsernames.set(username, [userMonitoringData]);
    }

    logToAdminChannel(
      `User ${message.author.tag} started monitoring Instagram username: "${username}"`
    );

    try {
      await message.author.send(
        `Now monitoring Instagram username "${username}". I'll check every minute and notify you via DM when it becomes available.`
      );
    } catch (error) {
      console.log(`Could not send DM to ${message.author.tag}`);
    }

    try {
      const result = await checkInstagramUsername(username);
      if (result.status === 404) {
        try {
          await message.author.send(
            `Initial check: The username "${username}" is already Unban!`
          );
        } catch (error) {
          console.log(`Could not send DM to ${message.author.tag}`);
        }

        if (monitoredUsernames.has(username)) {
          const userDataArray = monitoredUsernames.get(username);
          const updatedData = userDataArray.filter(
            (data) => data.userId !== message.author.id
          );

          if (updatedData.length === 0) {
            monitoredUsernames.delete(username);
          } else {
            monitoredUsernames.set(username, updatedData);
          }
        }
      } else {
        try {
          await message.author.send(
            `Initial check: The username "${username}" is currently Banned. I'll keep monitoring.`
          );
        } catch (error) {
          console.log(`Could not send DM to ${message.author.tag}`);
        }
      }
    } catch (error) {
      try {
        await message.author.send(
          `Initial check: The username "${username}" is currently Banned. I'll keep monitoring.`
        );
      } catch (error) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }
    }
  }

  if (message.content.startsWith("!unwatch ")) {
    const username = message.content.slice(9).trim();

    if (monitoredUsernames.has(username)) {
      const userDataArray = monitoredUsernames.get(username);
      const userIndex = userDataArray.findIndex(
        (data) => data.userId === message.author.id
      );

      if (userIndex !== -1) {
        userDataArray.splice(userIndex, 1);

        if (userDataArray.length === 0) {
          monitoredUsernames.delete(username);
        } else {
          monitoredUsernames.set(username, userDataArray);
        }

        logToAdminChannel(
          `User ${message.author.tag} stopped monitoring Instagram username: "${username}"`
        );

        try {
          await message.author.send(
            `Stopped monitoring Instagram username "${username}"`
          );
        } catch (error) {
          console.log(`Could not send DM to ${message.author.tag}`);
        }
      } else {
        try {
          await message.author.send(
            "You can only stop monitoring your own usernames."
          );
        } catch (error) {
          console.log(`Could not send DM to ${message.author.tag}`);
        }
      }
    } else {
      try {
        await message.author.send(
          `You weren't monitoring the username "${username}"`
        );
      } catch (error) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }
    }
  }

  if (message.content === "!list") {
    let userMonitored = [];
    for (const [username, userDataArray] of monitoredUsernames) {
      for (const data of userDataArray) {
        if (data.userId === message.author.id) {
          userMonitored.push({ username, data });
        }
      }
    }

    if (userMonitored.length === 0) {
      try {
        await message.author.send(
          "You're not monitoring any Instagram usernames."
        );
      } catch (error) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }
      return;
    }

    let list = "Your monitored Instagram usernames:\n";
    for (const { username, data } of userMonitored) {
      const monitoringTime = Date.now() - data.startTime;
      list += `- "${username}" (monitoring for ${formatTime(
        monitoringTime
      )})\n`;
    }

    try {
      await message.author.send(list);
    } catch (error) {
      console.log(`Could not send DM to ${message.author.tag}`);
    }
  }

  if (message.content === "!help") {
    const helpText = `
Instagram Username Monitor Bot Commands:
\`!watch <username>\` - Start monitoring an Instagram username
\`!unwatch <username>\` - Stop monitoring a username
\`!list\` - Show all your monitored usernames
\`!help\` - Show this help message

Admin Commands:
\`!adduser @user <duration>\` - Add user subscription (1week, 1month, 1year)
\`!removeuser @user\` - Remove user subscription
\`!listsubs\` - List all active subscriptions

The bot will check usernames every minute and notify you via DM when they become available.
Note: Instagram may block frequent requests, so monitoring might not be 100% reliable.
        `;

    try {
      await message.author.send(helpText);
    } catch (error) {
      console.log(`Could not send DM to ${message.author.tag}`);
    }
  }
});

// Function to log messages to admin channel
async function logToAdminChannel(message) {
  try {
    const channel = client.channels.cache.get(ADMIN_LOG_CHANNEL_ID);
    if (channel) {
      await channel.send(message);
    }
  } catch (error) {
    console.log("Could not send message to admin channel:", error);
  }
}

// Improved Instagram username check function with better error handling
async function checkInstagramUsername(username) {
  const url = `https://www.instagram.com/${username}/`;

  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/122.0",
  ];

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        Referer: "https://www.google.com/",
      },
      validateStatus: function (status) {
        return (status >= 200 && status < 300) || status === 404;
      },
    });

    const responseText = response.data;

    // Check for various indicators that the username is available
    const isAvailable =
      responseText.includes('"user":null') ||
      responseText.includes("Sorry, this page isn't available") ||
      responseText.includes("The link you followed may be broken") ||
      responseText.includes("Page Not Found") ||
      responseText.includes("login") || // Login page often means the account doesn't exist
      response.status === 404;

    return {
      status: isAvailable ? 404 : 200,
      data: response.data,
    };
  } catch (error) {
    console.log(`Instagram check failed for ${username}:`, error.message);

    // Log the error to admin channel
    logToAdminChannel(`Instagram API error for ${username}: ${error.message}`);

    // Return unavailable status on error to continue monitoring
    return { status: 200, data: null };
  }
}

// Check all usernames every 1 minute
cron.schedule("*/1 * * * *", async () => {
  if (monitoredUsernames.size === 0) return;

  // Add a longer initial delay
  await new Promise((resolve) => setTimeout(resolve, 3000));

  for (const [username, userDataArray] of monitoredUsernames) {
    if (userDataArray.some((data) => data.status === "checking")) continue;

    // Add much longer random delays between checks
    await randomDelay(10000, 30000); // 10-30 seconds between checks

    try {
      const updatedData = userDataArray.map((data) => ({
        ...data,
        status: "checking",
        lastChecked: Date.now(),
      }));
      monitoredUsernames.set(username, updatedData);

      const result = await checkInstagramUsername(username);

      if (result.status === 404) {
        for (const data of userDataArray) {
          if (
            !userSubscriptions.has(data.userId) ||
            userSubscriptions.get(data.userId).expiryDate < Date.now()
          ) {
            continue;
          }

          const totalTime = Date.now() - data.startTime;

          try {
            const user = await client.users.fetch(data.userId);
            await user.send(
              `✅ The Instagram username "${username}" is now available! It took ${formatTime(
                totalTime
              )}.`
            );
          } catch (error) {
            console.log(`Could not send DM to user ${data.userId}`);
          }

          logToAdminChannel(
            `✅ Username "${username}" became available for user ${
              data.userId
            } after ${formatTime(totalTime)}`
          );
        }

        monitoredUsernames.delete(username);
      } else {
        const updatedData = userDataArray.map((data) => ({
          ...data,
          status: "monitoring",
          lastChecked: Date.now(),
        }));
        monitoredUsernames.set(username, updatedData);
      }
    } catch (error) {
      const updatedData = userDataArray.map((data) => ({
        ...data,
        status: "monitoring",
        lastChecked: Date.now(),
      }));
      monitoredUsernames.set(username, updatedData);

      if (error.response && error.response.status === 429) {
        console.log("⚠️ Instagram rate limit hit. Waiting 10 minutes...");
        logToAdminChannel(
          "⚠️ Instagram rate limit hit. Pausing monitoring for 10 minutes."
        );
        await new Promise((resolve) => setTimeout(resolve, 10 * 60 * 1000));
      }

      console.log(`Check failed for username "${username}": ${error.message}`);
      logToAdminChannel(
        `Check failed for username "${username}": ${error.message}`
      );
    }
  }
});

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

process.on("SIGINT", () => {
  console.log("Shutting down bot...");
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Login failed:", error.message);
  process.exit(1);
});
