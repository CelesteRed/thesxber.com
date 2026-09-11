import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import { extensionFromUpload, getFanartEntries, removeFanart, saveFanartBuffer } from "./fanart.js";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });
const token = process.env.DISCORD_BOT_TOKEN;
const allowedUserIds = new Set((process.env.DISCORD_ALLOWED_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));

const commands = [
  new SlashCommandBuilder()
    .setName("fanart-upload")
    .setDescription("Upload fanart to thesxber.com")
    .addAttachmentOption((option) => option.setName("file").setDescription("Image to publish").setRequired(true))
    .addStringOption((option) => option.setName("title").setDescription("Optional gallery title").setMaxLength(120)),
  new SlashCommandBuilder().setName("fanart-list").setDescription("List published fanart"),
  new SlashCommandBuilder()
    .setName("fanart-remove")
    .setDescription("Remove published fanart")
    .addStringOption((option) => option.setName("filename").setDescription("Filename, for example fanart50.png").setRequired(true))
].map((command) => command.toJSON());

function authorized(interaction) {
  return allowedUserIds.has(interaction.user.id);
}

async function registerCommands(client) {
  const applicationId = process.env.DISCORD_APPLICATION_ID || client.user.id;
  const rest = new REST({ version: "10" }).setToken(token);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(applicationId, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(applicationId);
  await rest.put(route, { body: commands });
}

export async function startDiscordBot() {
  if (!token) {
    console.info("Discord bot disabled: DISCORD_BOT_TOKEN is not set.");
    return null;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once("ready", async () => {
    try {
      await registerCommands(client);
      console.info(`Discord bot ready as ${client.user.tag}. Fanart commands registered.`);
    } catch (error) {
      console.error("Discord command registration failed:", error.message);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!authorized(interaction)) {
      await interaction.reply({ content: "You are not authorized to manage fanart.", ephemeral: true });
      return;
    }

    try {
      if (interaction.commandName === "fanart-list") {
        const entries = await getFanartEntries();
        const body = entries.length
          ? entries.slice(-20).map((entry) => `${entry.filename}${entry.title ? ` — ${entry.title}` : ""}`).join("\n").slice(0, 1900)
          : "No fanart has been uploaded yet.";
        await interaction.reply({ content: body, ephemeral: true });
        return;
      }

      if (interaction.commandName === "fanart-remove") {
        const filename = interaction.options.getString("filename", true);
        await removeFanart(filename);
        await interaction.reply({ content: `Removed ${filename} from the gallery.`, ephemeral: true });
        return;
      }

      if (interaction.commandName === "fanart-upload") {
        const attachment = interaction.options.getAttachment("file", true);
        const extension = extensionFromUpload({ originalname: attachment.name, mimetype: attachment.contentType });
        if (!extension) {
          await interaction.reply({ content: "Please upload a JPG, PNG, WEBP, or GIF image.", ephemeral: true });
          return;
        }
        if (attachment.size > 15 * 1024 * 1024) {
          await interaction.reply({ content: "That image is larger than the 15 MB limit.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error("Discord attachment could not be downloaded");
        const buffer = Buffer.from(await response.arrayBuffer());
        const entry = await saveFanartBuffer(buffer, { extension, title: interaction.options.getString("title") || "" });
        await interaction.editReply(`Published ${entry.filename}. It is now live in the fanart gallery.`);
      }
    } catch (error) {
      const message = error.message || "Fanart action failed";
      if (interaction.deferred || interaction.replied) await interaction.editReply(`Unable to complete that action: ${message}`);
      else await interaction.reply({ content: `Unable to complete that action: ${message}`, ephemeral: true });
    }
  });

  await client.login(token);
  return client;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startDiscordBot().catch((error) => {
    console.error("Discord bot failed to start:", error);
    process.exitCode = 1;
  });
}
