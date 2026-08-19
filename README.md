# Glixera | Affiliate Services

[![CodeQL Advanced](https://github.com/Glixera-Innovations/glixera-affiliate/actions/workflows/codeql.yml/badge.svg)](https://github.com/Glixera-Innovations/glixera-affiliate/actions/workflows/codeql.yml)

Glixera Affiliate Services is a Discord bot for managing partnerships and affiliate relationships for **Glixera Innovations**. It provides a role-targeted weekly questionnaire for announcements, events, and partnership feedback.

## Purpose

The bot provides one consistent place for Glixera's public relations team to coordinate partnerships with other communities and external actors. It reduces repetitive administration while keeping access restricted to configured management roles.

## Commands

- `/weekly-checkup` sends the weekly questionnaire to a selected partnership role
- `/allowed-role add` authorizes an additional management role in the current server.
- `/allowed-role remove` removes a persistent management role.
- `/allowed-role list` shows the protected Fly-secret roles and server-specific persistent roles.

The server owner and roles in the protected `ALLOWED_ROLE_IDS` Fly secret can administer role access. Persistent additions are stored per server on the mounted Fly volume.

## Getting started

The project uses Node.js 24, TypeScript, discord.js, Docker, and Fly.io.

Local development:

1. Clone the repository and switch to the default `master` branch.
2. Run `npm ci`.
3. Add the required values to an ignored `.env` file.
4. Run `npm run check`.
5. Start the bot with `npm run dev`.

Never commit `DISCORD_TOKEN`, `CUSTOM_ID_SECRET`, or deployment configuration containing credentials.

## Fly.io deployment

Deployment secrets include:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_IDS`
- `ALLOWED_ROLE_IDS`
- `CUSTOM_ID_SECRET`

Deploy with `fly deploy -a glixera-affiliate`. The named `affiliate_data` volume stores persistent allowed-role configuration under `/data`.

## Privacy and data handling

Partnership management may involve Discord user IDs, guild IDs, role IDs, Roblox community information, staff notes, or contact details.

## Project status

Active development. The current application version is `0.2.0`.

## License

This project is licensed under the [MIT License](LICENSE).
