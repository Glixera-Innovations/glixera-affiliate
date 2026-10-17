# Glixera | Affiliate Services

[![Build and test](https://github.com/Glixera-Innovations/glixera-affiliate/actions/workflows/ci.yml/badge.svg)](https://github.com/Glixera-Innovations/glixera-affiliate/actions/workflows/ci.yml)
[![CodeQL Advanced](https://github.com/Glixera-Innovations/glixera-affiliate/actions/workflows/codeql.yml/badge.svg)](https://github.com/Glixera-Innovations/glixera-affiliate/actions/workflows/codeql.yml)

**Version 0.3.0** — a Discord bot for Glixera Innovations partnership questionnaires, feedback and ratings.

## Commands

| Command                                        | Purpose                                                                                                  | Access   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| `/weekly-checkup`                              | Post a questionnaire for a partnership role, with an optional separate response channel and period.      | Operator |
| `/user-info user:@person`                      | Show a user's profile, avatar/banner, account creation date and server membership/roles.                 | Operator |
| `/user-info user-id:123…`                      | Look up a numeric Discord user ID. Leave both lookup options empty to view yourself.                     | Operator |
| `/allowed-role add role:@team level:operator`  | Grant or change a role's access. `level` defaults to operator; choose manager to delegate configuration. | Manager  |
| `/allowed-role remove role:@team`              | Remove a role's explicitly granted access.                                                               | Manager  |
| `/allowed-user add user:@person level:manager` | Grant an individual server member operator or manager access.                                            | Manager  |
| `/allowed-user remove user:@person`            | Remove an individual's explicitly granted access.                                                        | Manager  |
| `/allowed-role list` or `/allowed-user list`   | View this server's role and individual access lists.                                                     | Operator |
| `/bot-settings show`                           | View the logging configuration and available settings commands.                                          | Operator |
| `/bot-settings log-channel channel:#logs`      | Enable usage logging in a server text channel.                                                           | Manager  |
| `/bot-settings test-log`                       | Check that a log entry can be delivered.                                                                 | Manager  |
| `/bot-settings disable-logs`                   | Stop posting new usage logs.                                                                             | Manager  |

Server owners and people with Discord's **Administrator** permission always have manager access. Managers can run all operator commands. An operator cannot change access or logging settings. Explicit role and individual grants are additive: removing one grant does not remove access obtained through another role or through Discord administration.

Commands and settings are scoped to the servers in `DISCORD_GUILD_IDS`. The bot grants access to its own commands; it does not assign Discord server roles or administrator permissions. Access lists support up to 100 entries per category.

## First-time configuration

1. Invite the bot with the `bot` and `applications.commands` scopes, and include your server's ID in `DISCORD_GUILD_IDS`.
2. As the server owner or a Discord administrator, use `/allowed-role add` or `/allowed-user add` to authorize your team.
3. Use `/bot-settings log-channel` to select a management log channel, then `/bot-settings test-log`.
4. Send a `/weekly-checkup` to a partnership role. Set `response-channel` to a private management channel if feedback should stay private.

The bot needs **View Channel**, **Send Messages**, and **Embed Links** in questionnaire, response and log channels. The operator posting a questionnaire must be able to view and send messages in both selected channels. The partnership role must be mentionable, or the bot needs **Mention @everyone, @here, and All Roles** in that questionnaire channel. The code limits the actual ping to the selected partnership role. The bot itself does not require Administrator permission or privileged Gateway intents.

## Questionnaires and ratings

The form contains, in order:

1. Announcements to share (write “None” if there are none).
2. Upcoming events (write “None” if there are none).
3. Written partnership feedback.
4. A required dropdown with **1, 2, 3, 4 or 5 stars**, with no default selection.

Ratings and non-empty written answers are validated again on submission. Results show the respondent's avatar/profile, written answers and star rating in an embed. Participants need the selected partnership role; bot operators can also respond. Each person can submit once per checkup. A closed checkup rejects forms that were already open, and closure/duplicate tracking survives restarts.

The new form uses Discord's current Label components. Existing 0.2.x weekly questionnaire buttons remain supported when the same `CUSTOM_ID_SECRET` is retained. A form already open during the upgrade must be reopened to include the mandatory rating. Older monthly questionnaire controls require a new checkup.

## Usage logging and user lookup

Logging is optional and disabled by default. Logs include command use, denied access, access/configuration changes, startup, checkups sent/closed and response metadata including the rating. Logs identify the acting Discord user and link to relevant messages. Written feedback is **not** copied to the log channel, and log entries do not ping people. Choose a channel whose membership is appropriate for this metadata; message links continue to follow Discord's channel access controls.

A deleted or inaccessible log channel does not prevent a successful checkup action. Fix the channel permissions or change the channel, then run `/bot-settings test-log`. Logging is best effort, with a bounded delivery queue; it is not a guaranteed compliance audit trail.

User lookup replies are visible only to the person running the command. Lookup supports a selected Discord user or a numeric ID, and shows public account details plus membership information from the current server. It does not search by arbitrary global username or expose email addresses, private messages or presence information.

## Development

Requirements: Node.js **24.17.0 or newer within the 24.x line**, and npm 11.9.0.

```bash
npm ci
cp .env.example .env
# Fill in the required values in .env.
npm run check
npm run dev
```

Build and run without the development watcher:

```bash
npm run build
npm run start:local
```

`npm start` runs the compiled production bot using environment variables supplied by the host. `npm run start:local` additionally loads the ignored `.env` file. GitHub Actions runs type checking, regression tests, a production build and a production dependency audit. Tests use temporary local files and mocked Discord interactions; they do not contact a live Discord server.

## Environment variables

| Variable            | Required | Purpose                                                                                                           |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`     | Yes      | Discord bot token.                                                                                                |
| `DISCORD_CLIENT_ID` | Yes      | Discord application ID.                                                                                           |
| `DISCORD_GUILD_IDS` | Yes      | Comma-separated server IDs; legacy `DISCORD_GUILD_ID` remains supported.                                          |
| `CUSTOM_ID_SECRET`  | Yes      | Stable signing secret of at least 32 characters. Keep its existing value on upgrades.                             |
| `ALLOWED_ROLE_IDS`  | No       | Legacy comma-separated roles imported once as managers for each configured server. New installations can omit it. |
| `DATA_DIR`          | No       | Persistent storage directory; local default `./data`, Docker/Fly default `/data`.                                 |
| `TIME_ZONE`         | No       | Time zone for automatic weekly periods; default `Europe/Brussels`.                                                |
| `PORT`              | No       | Health HTTP listener port; default `8080`.                                                                        |
| `HEALTH_HOST`       | No       | Default `127.0.0.1` locally. The Docker image and Fly configuration explicitly set `0.0.0.0`.                     |

Never commit real tokens, signing secrets, `.env` files, logs or runtime data. `.env.example` deliberately contains no credentials.

## Storage and upgrade from 0.2.0

Back up the entire data directory before deploying. Keep the existing Fly volume, token, signing secret and server IDs.

- `allowed-roles.json`: per-server operator/manager role grants, individual grants and log channel configuration. Version 1 data is automatically upgraded to version 2. A copy of the old file is retained as `allowed-roles.json.v1.bak` before migration.
- On the first 0.3.x startup for a configured server, `ALLOWED_ROLE_IDS` is imported as manager roles. Existing saved allowed roles remain operators. Once imported, roles can be changed or removed in Discord; leaving the old environment variable in place will not re-add a removed role after a restart.
- `checkups.json`: questionnaire IDs, destinations, closure state and per-person response IDs/retry nonces. Written answers are stored as Discord messages, not duplicated in local files. Closed checkup metadata older than 90 days is pruned when a new questionnaire is created; active checkups are retained. The store has a 5,000-checkup safety limit.
- Writes are serialized and replace files atomically. Invalid stored configuration stops startup and preserves the file for recovery; it does not silently reset permissions.

Keep **both JSON files** when backing up or later moving hosts. Run one bot instance against these files; multiple replicas are not supported. Rolling back to 0.2.0 requires restoring the version 1 access file from your backup. Turning logging off does not delete messages already posted in Discord.

## Fly.io deployment

This release retains the existing Fly application and volume configuration; it does not migrate hosting.

```bash
fly deploy -a glixera-affiliate
```

Keep `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_IDS` and `CUSTOM_ID_SECRET` as Fly secrets. The `affiliate_data` volume remains mounted at `/data`. Slash commands are registered during startup. A configured server must accept command registration; check the bot installation and `applications.commands` scope if startup fails.

`GET /health` is a liveness check and stays available while Discord connects. `GET /ready` returns 503 until Discord is ready and 200 afterwards. The health port does not need a public domain or port mapping for Gateway bot operation.

## Release verification

See [CHANGELOG.md](CHANGELOG.md) for the changes and [TESTING.md](TESTING.md) for the live-server smoke test checklist. No live Discord deployment is performed by the local automated tests.

## Privacy and license

The bot processes Discord user/server/role/channel IDs, access settings and partnership feedback. Use suitable access controls on response and log channels, protect the data directory and backups, and follow your community's retention practices.

Licensed under the [MIT License](LICENSE).
