# Release verification

## Automated checks

```bash
npm ci
npm run check
npm run build
npm audit
```

The regression suite covers access boundaries, guild isolation, persistent settings and migration, concurrent changes, closed forms, duplicate responses, retry nonces, compact signed controls, required ratings, maximum-length embeds, user lookup formatting, log delivery failures, credential redaction and health/readiness responses.

These tests do not use a Discord token, contact a live Discord server or deploy the bot. A Docker image build also needs to be verified where Docker is available.

## Live Discord smoke test

Use a test server and a suitable response/log channel before announcing the release.

1. Confirm all five slash-command groups are registered after startup.
2. As the owner or a Discord administrator, add an operator role, an individual operator and a separate manager. Verify the grants in `/allowed-role list`.
3. Confirm an ordinary member cannot run management commands, an operator can run checkups/user lookup, and only a manager can change access or logs. Confirm that removing an explicit grant does not override other authorized roles or Administrator permission.
4. Select a log channel, run the test command, and confirm command/access/checkup events identify the actor without pinging anyone or copying feedback text. Disable logs and confirm further events stop.
5. Look up a selected member, a valid ID, an unknown ID and yourself. Verify the reply is private and avatars, optional banners, creation/join dates and roles display correctly.
6. Send a questionnaire, including one with a long period containing emoji or non-Latin text. Confirm the correct partnership role is pinged once.
7. Open the form on desktop and mobile. Confirm the fourth field is the required 1–5 star dropdown, with no default, and the written fields use the current modal layout.
8. Submit each end-point rating (1 and 5) using separate checkups. Check the respondent, written answers, visual rating and selected response destination. An unauthorized user must not open or submit the form.
9. Attempt a second response from the same person; it must be rejected. Open a form, close its questionnaire as an operator, then submit that old form; it must be rejected.
10. Restart the bot and verify access settings, log configuration, closed checkups and duplicate checks remain intact. Preserve both JSON files on the persistent volume.
11. If upgrading, open a 0.2.x weekly questionnaire and verify the new form is offered using the original signing secret. A form opened before the upgrade should ask to be reopened. Verify `allowed-roles.json.v1.bak` exists if a version 1 access file was migrated.
12. Remove log-channel access (or delete the channel) and confirm checkup actions still work while the test-log command reports the problem. Restore logging afterwards.

## Delivery retry limitation

Discord only deduplicates enforced message nonces for a limited recent interval. The bot persists a retry nonce before delivery and the response ID afterwards. A crash precisely between remote delivery and the final local write can still require manual checking after a long outage; there is no distributed transaction spanning Discord and local JSON files. When an action reports a failure, inspect the destination before retrying.
