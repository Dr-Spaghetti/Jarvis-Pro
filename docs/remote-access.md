# Remote access — use Jarvis from your phone

This guide walks you through exposing Jarvis securely outside your home
network using a Cloudflare Tunnel. When you're done you'll open a URL like
`https://jarvis.yourdomain.com` on your phone, enter your access token once,
and use the full HUD from anywhere.

**Security model (read this first):**

- Jarvis refuses to start in remote mode unless `OCTOGENT_AUTH_TOKEN` is set.
- With the token set, **every** API and WebSocket request must present it.
  The web UI asks for it once and remembers it per device.
- The tunnel is outbound-only — no ports are opened on your router.
- Never share the token. Anyone with it can run agents on your PC.

Total setup time: about 20 minutes, one time only.

---

## Step 1 — Create your access token (2 min)

1. Open your project folder (`C:\Users\nicks\octogent-skills`) in File Explorer.
2. Right-click `.env` → **Open with** → **Notepad**.
3. Add this line at the bottom (replace the value with your own random
   secret — at least 24 characters, letters and numbers):

   ```
   OCTOGENT_AUTH_TOKEN=replace-this-with-a-long-random-secret
   ```

   ⚠️ **No spaces around the `=` sign, and no space at the start of the line.**

   Need a random value? Press the Windows key, type `powershell`, press Enter,
   then paste this and press Enter — copy the output into `.env`:

   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
   ```

4. Also add this line so the tunnel always finds Jarvis on the same port:

   ```
   OCTOGENT_API_PORT=8787
   ```

5. Save the file (Ctrl+S) and close Notepad.

To check it worked: double-click **Start Jarvis (Remote).bat**. If the token
line is missing or empty it will tell you and stop. (It will warn that the
tunnel isn't running yet — that's expected until Step 3.)

## Step 2 — Install cloudflared (3 min)

1. Press the Windows key, type `powershell`, press Enter.
2. Paste this and press Enter:

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

3. When it finishes, close PowerShell.

## Step 3 — Create the tunnel in the Cloudflare dashboard (10 min)

You need a free Cloudflare account and a domain managed by Cloudflare.
(If you don't have a domain, you can buy one inside Cloudflare for ~$10/year:
dashboard → **Domain Registration** → **Register Domain**.)

1. Go to <https://one.dash.cloudflare.com> and sign in (create the free
   account if you don't have one — choose the **Free** plan everywhere).
2. In the left sidebar click **Networks** → **Tunnels**.
3. Click **Create a tunnel** → choose **Cloudflared** → **Next**.
4. Name it `jarvis` → **Save tunnel**.
5. On the "Install and run a connector" page, click **Windows** and copy the
   command it shows (it looks like
   `cloudflared service install eyJh...` — the long code is unique to you).
6. Press the Windows key, type `powershell`, **right-click Windows PowerShell
   → Run as administrator**, paste the command, press Enter. This installs the
   tunnel as a Windows service — it starts automatically with your PC.
7. Back in the browser, the connector should show as **Connected** within a
   minute. Click **Next**.
8. On the "Route traffic" page add a public hostname:
   - **Subdomain:** `jarvis`
   - **Domain:** pick your domain
   - **Type:** `HTTP`
   - **URL:** `127.0.0.1:8787`
9. Click **Save tunnel**.

## Step 4 — Start Jarvis in remote mode and test (5 min)

1. Double-click **Start Jarvis (Remote).bat** in the project folder.
   (The plain **Start Jarvis.bat** stays local-only — use whichever you need.)
2. On your phone, open `https://jarvis.yourdomain.com` (the hostname from
   Step 3.8).
3. Jarvis shows an **access token** screen. Enter the value of
   `OCTOGENT_AUTH_TOKEN` from your `.env` and tap **Unlock**. The phone
   remembers it — you won't be asked again on that device.
4. You're in. The 1–9 navigation, brain search, and voice all work remotely.

## Day-to-day use

- **Remote mode:** run **Start Jarvis (Remote).bat**. Local mode: the normal
  **Start Jarvis.bat** (no token needed in the browser on your PC).
- The tunnel service runs in the background all the time; that's fine — when
  Jarvis isn't running, the URL just shows an error page.
- **Lost or leaked token?** Change the `OCTOGENT_AUTH_TOKEN` value in `.env`
  and restart Jarvis. Every device must enter the new token. You can also
  remove a saved token from a device in **Settings → Remote access →
  Forget token**.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Launcher says token missing but you added it | Check `.env` for a space before or after `=`, or a space at the start of the line. |
| Phone shows Cloudflare error 1033 | Tunnel service not running — re-do Step 3.5–3.6, or run `services.msc` and start **cloudflared**. |
| Phone shows "Could not reach the server" | Jarvis isn't running on the PC, or it started on a different port — make sure `OCTOGENT_API_PORT=8787` is in `.env` and nothing else uses port 8787. |
| Token screen says the token was rejected | The value typed doesn't match `.env` exactly — copy-paste it. |
| Works on PC, asks for token there too | That's expected when `OCTOGENT_AUTH_TOKEN` is set — enter it once on the PC browser as well. |
