const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const cron = require("node-cron");

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Store monitored Instagram usernames with their start times
const monitoredUsernames = new Map();

// Bot is ready - using clientReady to avoid deprecation warning
client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Monitoring ${monitoredUsernames.size} Instagram usernames`);
});

// For backward compatibility, also listen to the old ready event
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}! (using legacy ready event)`);
  console.log(`Monitoring ${monitoredUsernames.size} Instagram usernames`);
});

// Handle messages
client.on("messageCreate", async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Command to start monitoring an Instagram username
  if (message.content.startsWith("!watch ")) {
    const username = message.content.slice(7).trim();

    // Validate username
    if (!username || username.length < 1) {
      return message.reply("Please provide a valid Instagram username");
    }

    // Check if already monitoring this username
    if (monitoredUsernames.has(username)) {
      return message.reply(`I'm already monitoring the username "${username}"`);
    }

    // Add to monitoring list
    monitoredUsernames.set(username, {
      startTime: Date.now(),
      channelId: message.channel.id,
      userId: message.author.id,
      status: "monitoring",
      lastChecked: Date.now(),
    });

    message.reply(
      `Now monitoring Instagram username "${username}". I'll check every 30 seconds and notify you when it becomes available.`
    );

    // Send initial test
    try {
      const response = await checkInstagramUsername(username);
      if (response.status === 200) {
        message.channel.send(
          `Initial check: The username "${username}" is already available!`
        );
        monitoredUsernames.delete(username);
      } else {
        message.channel.send(
          `Initial check: The username "${username}" is currently unavailable. I'll keep monitoring.`
        );
      }
    } catch (error) {
      message.channel.send(
        `Initial check: The username "${username}" is currently unavailable. I'll keep monitoring.`
      );
    }
  }

  // Command to stop monitoring a username
  if (message.content.startsWith("!unwatch ")) {
    const username = message.content.slice(9).trim();

    if (monitoredUsernames.has(username)) {
      monitoredUsernames.delete(username);
      message.reply(`Stopped monitoring Instagram username "${username}"`);
    } else {
      message.reply(`I wasn't monitoring the username "${username}"`);
    }
  }

  // Command to list monitored usernames
  if (message.content === "!list") {
    if (monitoredUsernames.size === 0) {
      return message.reply(
        "No Instagram usernames are currently being monitored."
      );
    }

    let list = "Currently monitored Instagram usernames:\n";
    for (const [username, data] of monitoredUsernames) {
      const monitoringTime = Date.now() - data.startTime;
      list += `- "${username}" (monitoring for ${formatTime(
        monitoringTime
      )})\n`;
    }

    message.reply(list);
  }

  // Help command
  if (message.content === "!help") {
    const helpText = `
Instagram Username Monitor Bot Commands:
\`!watch <username>\` - Start monitoring an Instagram username
\`!unwatch <username>\` - Stop monitoring a username
\`!list\` - Show all monitored usernames
\`!help\` - Show this help message

The bot will check usernames every 30 seconds and notify you when they become available.
Note: Instagram may block frequent requests, so monitoring might not be 100% reliable.
        `;

    message.reply(helpText);
  }
});

// Function to check Instagram username availability
async function checkInstagramUsername(username) {
  const url = `https://www.instagram.com/${username}/`;

  try {
    // We use a custom header to try to avoid Instagram's bot detection
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      validateStatus: function (status) {
        // Consider both 200 and 404 as valid responses
        return (status >= 200 && status < 300) || status === 404;
      },
    });

    return response;
  } catch (error) {
    // If we get an error, treat it as if the username is unavailable
    // This handles cases where Instagram blocks our requests
    throw new Error("Username check failed");
  }
}

// Check all usernames every 30 seconds
cron.schedule("*/30 * * * * *", async () => {
  if (monitoredUsernames.size === 0) return;

  // Add a small delay to avoid hitting Instagram too rapidly
  await new Promise((resolve) => setTimeout(resolve, 1000));

  for (const [username, data] of monitoredUsernames) {
    // Skip if we're already processing this username
    if (data.status === "checking") continue;

    // Add a small delay between checking each username
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      // Mark as checking to prevent overlapping requests
      monitoredUsernames.set(username, {
        ...data,
        status: "checking",
        lastChecked: Date.now(),
      });

      const response = await checkInstagramUsername(username);

      if (response.status === 200) {
        // Username is available!
        const totalTime = Date.now() - data.startTime;

        // Get the channel and send notification
        const channel = client.channels.cache.get(data.channelId);
        if (channel) {
          channel.send(
            `<@${
              data.userId
            }> The Instagram username "${username}" is now available! It took ${formatTime(
              totalTime
            )} to become available.`
          );
        }

        // Remove from monitoring list
        monitoredUsernames.delete(username);
      } else {
        // Username is still unavailable, continue monitoring
        monitoredUsernames.set(username, {
          ...data,
          status: "monitoring",
          lastChecked: Date.now(),
        });
      }
    } catch (error) {
      // If check failed, continue monitoring
      monitoredUsernames.set(username, {
        ...data,
        status: "monitoring",
        lastChecked: Date.now(),
      });

      console.log(`Check failed for username "${username}": ${error.message}`);
    }
  }
});

// Format milliseconds to a readable time format
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

// Handle process termination
process.on("SIGINT", () => {
  console.log("Shutting down bot...");
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
