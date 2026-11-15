# Connect the campaign prototype to Google

The app runs as a static website. Each participant authorizes their own Google
account. There is no application server, service account, or Firebase project.
The developer's Codex Google connector is not used by the website.

The local builder works without this setup. Google sign-in, file creation,
cross-account access, and native cross-file calendar refresh still need the
real-account verification below before this prototype is ready for a campaign.

The initial project is **Ars Ratiocinandi**, project ID `ars-ratiocinandi`,
project number **862096805277**. The intended initial website is
`https://www.ofria.com/Ars/`. Its Google configuration must include the production
entries below as well as the localhost entries used during development.

## One-time setup by the app developer

1. Open [Google Cloud Console](https://console.cloud.google.com/) with the account
   that will maintain the app. Create a project, for example `Ars Ratiocinandi`.
   Record its **project number** from the project dashboard. This is the numeric
   number, not the project name or textual project ID. All credentials below
   belong to this same project. No hosted server needs to be purchased.
2. In **APIs & Services → Library**, enable **Google Drive API**, **Google Sheets
   API**, and **Google Picker API**. This prototype does not need Firebase or a
   billing upgrade. If an organization policy prevents access, resolve that
   with the account administrator before proceeding.
3. Open **Google Auth platform**. Configure **Branding** with an app name,
   support email, and developer contact. Set **Audience** to **External** so
   ordinary consumer Google accounts can participate. Keep the app in
   **Testing**, and add your account and a second tester's account as test users.
   An organization-only Internal app will not work for players outside that
   organization.
4. In **Data Access**, add only this scope:
   `https://www.googleapis.com/auth/drive.file`.
   It grants app access to selected/app-created files, rather than the user's
   entire Drive. The app uses that scope for both Drive and Sheets calls.
5. In **Clients**, create an OAuth client of type **Web application**. Add these
   **Authorized JavaScript origins** for this checkout:

   ```text
   http://localhost
   http://localhost:5173
   http://127.0.0.1:5173
   ```

   Origins contain the scheme, hostname, and optional port, with no path or
   trailing slash. Add the actual port if Vite starts on a different one.
   For the initial website, also add `https://www.ofria.com`. Do not include
   `/Ars/` in an origin. Also add `https://ofria.com`: the existing website
   redirects `www.ofria.com` to this hostname. Keep the localhost entries.
   This implementation uses Google's browser token popup; it does not need a
   server callback or an Authorized redirect URI.

   To obtain the **client ID**, go back to **Google Auth platform → Clients**
   and open the Web application client whose origins you just configured.
   Find the field labelled **Client ID** and copy its entire value, including
   the `.apps.googleusercontent.com` ending. This is a separate identifier from
   the project ID, project number, and Picker API key. Put it in
   `VITE_GOOGLE_CLIENT_ID` in step 7. The app does not use a **Client secret**;
   never put that secret in the website or its environment file.
6. In **APIs & Services → Credentials**, create an **API key** for Picker.
   Set **Application restrictions → Websites** and allow:

   ```text
   http://localhost:5173/*
   http://127.0.0.1:5173/*
   https://docs.google.com/*
   https://www.ofria.com/*
   https://ofria.com/*
   ```

   The `docs.google.com` entry is required for Picker's Google-hosted iframe. Restrict the
   key's API access to **Google Picker API**. The `www.ofria.com` referrer entry
   authorizes the initial website. Use the host-wide pattern because browser
   cross-origin referrers may omit the `/Ars/` path. Drive and Sheets requests
   use the OAuth token, not this API key.
7. In `/Users/charles/Sites/mercere99.github.io/Ars`, copy `.env.example` to
   `.env.local`, and replace its placeholders:

   ```dotenv
   VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
   VITE_GOOGLE_API_KEY=your-restricted-picker-api-key
   VITE_GOOGLE_APP_ID=862096805277
   ```

   These are browser-visible app identifiers. **Do not put an OAuth client
   secret, service-account JSON, password, or access token in this file.**
   `.env.local` is ignored by Git. A production static build includes these
   public identifiers, so key/origin restrictions still matter.
8. Restart Vite so it reads the new environment:

   ```sh
   cd /Users/charles/Sites/mercere99.github.io/Ars
   npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
   ```

   Stop an existing instance with Control-C before restarting it. Use a regular
   Chrome, Firefox, or Safari window for Google authorization. Google restricts
   OAuth in embedded webviews, which may include an application's preview panel.

Google occasionally changes console navigation labels. The linked official
guides below describe the same project, client, key, and origin requirements.

## Initial website at www.ofria.com/Ars/

| Setting | Value |
| --- | --- |
| Website address | `https://www.ofria.com/Ars/` |
| Additional OAuth JavaScript origin | `https://www.ofria.com` |
| Final-host OAuth JavaScript origin | `https://ofria.com` |
| Additional Picker API-key website restriction | `https://www.ofria.com/*` |
| Final-host Picker API-key website restriction | `https://ofria.com/*` |
| Branding authorized domain, if requested | `ofria.com` |
| Picker App ID / `VITE_GOOGLE_APP_ID` | `862096805277` |

HTTPS and `www` are significant: an address without `www` is a different origin.
If the host redirects to another hostname, authorize the final hostname used in
the browser. Keep the local origins/referrers above for development. While the
OAuth app remains in Testing, add every testing account under **Audience →
Test users**, including your own account and the second account for sharing tests.

The existing Vite configuration uses a relative asset base (`./`), suitable for
the `/Ars/` subdirectory. `.env.local` is read by Vite during development and
builds. Rebuild with `npm run build` after changing its values. For deployment,
upload the **contents of `dist/`** to `/Ars/`. In this existing GitHub Pages
checkout, run `npm run prepare-pages` to build and place those files in the
correct directory, then commit the project including `index.html`, `assets/`,
and `pages-assets.json`. The editable HTML entry is `web/index.html`.
Do not upload `.env.local` or expect a static web server to read it.

## Create the first shared campaign

1. In the **Campaign** selector at the top, choose **Create campaign…**, enter
   a name, and click **Create campaign**. Expand **Google Sheets & shared session
   prototype** and click **Connect Google**. Select your account and grant the
   selected-file permission. Tokens stay in browser memory; reconnect after
   reload/expiry. Campaign setup is saved in this browser until its shared files
   are created; creating a campaign does not itself create Google files.
2. Before clicking **Create campaign files**, use **Choose location for new
   campaign folders** to pick an existing folder in My Drive. The selection is
   saved with this campaign in the browser. Leaving it unset uses My Drive's top level.
   The app creates the records and app-state folders side by side there, with
   the calendar inside records and your session folder inside app state.
   Use a private parent if you want to share the two folders differently;
   new files and folders inherit the parent's sharing. The app does not change
   Drive permissions or send invitations automatically. Retrying interrupted
   creation reuses any folders already created, even if you change the location.
3. In Drive, share the **records** folder with the troupe as **Editors**. Share
   the **app-state** root with them as **Viewers**. Keep these as separate folder
   trees: placing app state inside an editor-shared records folder would inherit
   broader write permissions.
4. Each additional member should own their own session folder in their My Drive
   and share it with everyone else as **Viewers**. It can remain outside the
   first person's app-state root. Each member selects their own folder using
   **Choose my writable session folder**, and other members add it with **Add
   shared session folder**. This avoids needing to grant every member editing
   access to one parent's entire hierarchy. The uploader owns its session files;
   choosing a folder owned by another member does not grant ownership of their
   existing files.
5. A joining member chooses **Join campaign…** in the top **Campaign** selector,
   connects Google, and uses **Choose campaign Sheet** to select the shared
   calendar. No placeholder campaign is needed. The app reads its stable
   campaign ID. It does not copy or overwrite the calendar. Expand the campaign's
   **Google Sheets & shared session prototype** panel and use
   **Choose campaign records folder** to select the troupe's editor-shared
   records folder before creating character Sheets. New Sheets inherit its
   sharing; joining members should not create isolated copies in My Drive.
6. Folder sharing and app authorization are separate. Do not assume choosing a
   folder exposes every child to `drive.file`. If discovery misses another
   member's files, use **Authorize individual event files** to select those JSON
   files in Picker. Similarly, select an existing character Sheet before reading
   it. This explicit selection is a feasibility gate for the prototype, not a
   promise of seamless folder-wide authorization.

All participants use the same developer-configured website and Cloud project.
Players do not create their own OAuth clients or paste tokens into the app.
Storyguide status will not change these game-record permissions.

### Returning to the site and inviting another player

The browser remembers campaigns, selected Drive file/folder IDs, and which
campaign was active. Google access tokens remain only in memory: after a full
reload or reopening the page, a fresh token is needed. Selecting a linked
campaign or **Join campaign…** starts reconnection directly from that selection
if a past connection is remembered. Libraries are prepared ahead of the click
so the Google dialog can open during the user gesture. If loading, a blocker,
or cancellation prevents this, **Connect Google** remains available to retry.
The browser saves only a reconnect preference, never the access token. An
explicit **Disconnect** turns off that automatic behavior until you connect
again. Google remembers previously granted consent, though sign-in or consent
may still be requested.
Tokens also expire during long visits; reconnect when prompted. Saving an access
token locally would only reuse its remaining short lifetime, not provide a
permanent connection. This static app does not keep refresh tokens or require a
server for sign-in.

### Remove a campaign from this browser

Select the campaign, then choose **Delete current campaign…** in the same
selector. Review the explanation and either cancel or confirm **Delete from
this browser**. Its character drafts are kept under **Local drafts**. Drive
files, other members' campaign entries, and locally queued session history are
not deleted. A popup explains that you must separately move the records and
app-state folders to Trash in Google Drive if you want to remove those too.
Rejoining the shared calendar later adds the campaign back to this browser.

### Campaign defaults and character creation

Set a location and default language while creating a campaign, or on its home
screen before it is linked to Google. Once linked, edit those values in the
campaign Sheet and use **Refresh calendar**. New character drafts start with
native language 5 (75 free XP) and common childhood/later-life ability rows at
0. Area Lore uses the location as an editable initial subject. No non-native
XP is assigned automatically; the player still chooses where to spend it.
Changing campaign defaults does not rewrite existing characters. Generated
grogs also use the campaign language and location when supplied.

The editor's **Back to campaign** controls return to the roster while preserving
the draft. Virtues/Flaws can be filtered by kind, category, and size, alongside
search. Hovering, focusing, or tapping ability and Virtue/Flaw names opens their
local rules text. Base Characteristics remain −3 to +3; disabled limit buttons
explain Great/Poor Characteristic and applicable Giant Blood/Dwarf options.
The builder applies those supported final-score changes, including Stamina's
Soak contribution, and Improved Characteristics' extra point budget. Other
Virtue effects still need adjudication. Magus creation remains incomplete;
the starter helper prepares its study rows without claiming a complete build.

Findings include **How to fix** guidance (or **Next steps** for informational
items). Ability-access findings have expandable lists of granting Virtues and
Flaws, filtered for obvious build restrictions; hover, focus, or tap a suggested
name to read its full description before choosing it. Adding an entry still
requires checking its background requirements, point balance, and Social Status
compatibility. Missing Social Status instead points to the `social-status`
filter with Both kinds and All sizes, including Free choices. Budgets, creation
score caps, dates, native language, characteristic choices, repeated entries,
and the declared Virtue/Flaw limits each have specific advice. Suggestions do
not change the character automatically or remove the ability to record a troupe
exception.

### Additional players

New players need access to a deployed copy of the site; `127.0.0.1` refers to
their own computer, not the developer's. While the OAuth app is in Testing, the
developer must add each participant's Google email under **Audience → Test users**.
Share the records folder as Editors and app state as Viewers with those same
accounts. They then use **Join campaign…** as described above. For two-way session
events, each player also selects their own writer-owned folder, shares it with
the troupe as Viewers, and selects other members' session folders for reading.
Joining the calendar does not automatically discover all character Sheets or
session folders; the explicit Picker selections described above are still needed.

### Reorganize existing campaign folders

Move the records and app-state folders to your preferred location in My Drive
using Google Drive. Links, calendar formulas, and saved app references use stable
file/folder IDs, so moving or renaming the folders preserves those references.
Moving a whole folder keeps its children together and preserves event discovery.
If you move individual session files out of the selected session folders, select
their new folder or authorize those files individually in the app.

Check sharing after a move: the destination's inherited permissions apply to
the moved folders and their contents. In particular, putting app state under an
editor-shared parent grants inherited editing access there. Moving into Workspace
shared drives is outside the prototype's tested My Drive setup.

## Create and use a character Sheet

Open a companion or grog draft in the campaign and use **Create Sheet for this
character**. Open the resulting link. In Identity, the campaign year uses
`IMPORTRANGE`; Google may show `#REF!` until you select that cell and click
**Allow access**. Check that campaign year and age calculate before reading the
character in the website. A broken calendar link is reported rather than
silently replaced with 1220.

After creation, edit the character directly in Google Sheets. The app's
**Read current values** action fetches calculated values; it never saves the
local builder over the established character Sheet. A creation retry reuses
the recorded operation/file ID. To intentionally create a different character,
make a new draft rather than reusing the same draft's creation operation.

Creation XP allocations and later Advancement awards have separate tabs.
Adding later XP does not increase a creation budget. Blue cells are inputs;
other cells contain labels, IDs, or formulas. Preserve stable IDs and named
ranges. See [the workbook contract](SHEET_CONTRACT.md) for capacities, supported
calculations, and manual rules.

## Two-account acceptance test

Use **two distinct Google accounts**, ideally in separate browser profiles or
on separate computers. Two tabs in one Google account cannot prove sharing.
Record findings in [GOOGLE_TEST_RESULTS.md](GOOGLE_TEST_RESULTS.md).

1. Account A creates a disposable campaign. B selects its shared campaign Sheet.
   Check both read the same ID/year. Change the year directly in Sheets and
   refresh the calendar in both interfaces.
2. Provision one writer-owned session folder per member as above. A and B each
   publish test events. Authorize individual event files if folder selection
   alone does not expose them. Confirm each sees **all** retained events from
   both accounts, not just the last event. Add simultaneous events as well.
3. Keep two tabs open for A. Publish from each and check that they create
   different session files. Neither tab should replace the other's history.
4. Interrupt connectivity before publishing. Check that the event is marked
   pending. Reconnect and retry; retain its event ID. Reload with an unshared
   outbox and use **Retry queued upload** after reconnecting as the same account.
   Check that acknowledged events are not duplicated or removed.
5. Reconnect after authorization expires. Test a cancelled sign-in, a revoked
   sharing grant, an inaccessible file, and recovery after restoring access.
   Valid files should remain usable when another file fails to read.
6. A creates a companion Sheet and enables its calendar import. Close the
   website. In Sheets, record XP on Advancement: verify scores and surplus across
   a threshold, a permanent bonus, and a **zero** score override. Reopen the app,
   select/authorize the Sheet, and read the same calculated values. Rename the
   file and confirm the file-ID link survives.
7. Change the campaign year directly in its Sheet. Verify Google propagates it
   to the character's age while its creation XP budget and earned XP stay fixed.
   Check the inaccessible-calendar error too. Native cross-file propagation can
   take time; record what you observe before calling it current.
8. While both foreground tabs are open, measure receipt delay for several
   remote events. Aim for roughly five seconds in ordinary conditions, then
   measure hidden-tab behavior. Use the browser's Network panel to count Drive
   metadata/list/body requests over a ten-minute representative session.
   No measured latency or quota result is claimed until this test is run.

The poller normally waits five seconds between foreground passes and backs off
to at most a minute after errors; hidden tabs use thirty seconds. A pass takes
additional network time. Metadata versions avoid re-downloading unchanged JSON,
but every selected stream/folder still costs metadata/list requests. The current
prototype scans selected folders plus one subfolder level, with a 2,000-file
limit per listing and 5,000 events per session. No push server is involved.

Queued recovery uses browser Web Locks to coordinate with other open tabs.
Use a current browser supporting that API. The selected calendar year is cached
locally between visits; use **Refresh calendar** before starting new character
drafts after the campaign year changes. Canonical character age formulas read
the campaign Sheet independently of this builder cache.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Connect stays disabled | All three environment values are present; restart Vite. Use Retry loading if Google's scripts were blocked. |
| `origin_mismatch` | OAuth JavaScript origin exactly matches the address bar's scheme/host/port. |
| Access blocked / tester cannot sign in | External Testing audience; both emails listed as testers; ordinary browser; organization policies. |
| Picker says developer key is invalid | Picker API enabled; correct project; referrers include `https://docs.google.com/*` and the local host/port. |
| File exists in Drive but app gets denied or lists nothing | Share it with this account **and** select it in Picker for app access. |
| Character read says not a calculated number | Open the Sheet and inspect its formula; enable the calendar's Allow access prompt. |
| A creation outcome is uncertain | Inspect Drive, then retry the same operation. The app deliberately avoids creating another character copy automatically. |
| Updates pause after a while | Reconnect Google. Tokens are neither stored on disk nor silently refreshed in the background. |

## Official references

- [Create a web OAuth client](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Configure Google Picker and its key restrictions](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Picker example and numeric App ID](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample)
- [Selected-file Drive scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [OAuth policy on embedded browsers](https://developers.google.com/identity/protocols/oauth2/policies)
- [IMPORTRANGE access and refresh behavior](https://support.google.com/docs/answer/3093340)
