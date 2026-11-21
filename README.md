# Tableside

Table ordering for a hotel restaurant. One website, two sides:

- **Guests** scan the QR code on their table (`/t/5`), order from the menu, press **Call waiter**, and get free Wi-Fi after ordering.
- **Manager** opens `/manager` on any phone, tablet or PC, logs in with a PIN, and sees orders and requests **live** (no refreshing).

No database server and no npm packages. Needs Node 18 or newer.

## Run it on your computer

```bash
MANAGER_PIN=4321 node server.js
```

Open http://localhost:3000 (guest) and http://localhost:3000/manager (manager).
On Windows PowerShell: `$env:MANAGER_PIN="4321"; node server.js`

## Settings (environment variables)

| Name | What it does |
|---|---|
| `MANAGER_PIN` | PIN for the manager login. **Set this before going live.** |
| `SECRET` | Any long random text. Keeps manager logins valid after a restart. |
| `PORT` | Set automatically by most hosts. |
| `DATA_FILE` | Where orders are saved. Default `data/store.json`. |
| `TZ` | Time zone for "today" totals. Default `Asia/Kolkata`. |

## Put it online

Any host that runs Node works. The start command is `npm start`.

1. Push this folder to a GitHub repository.
2. Create a new web service on Railway, Render or Fly.io from that repository.
3. Add `MANAGER_PIN` and `SECRET` in the host's environment settings.
4. **Attach a persistent disk or volume** and point `DATA_FILE` at it (for example `/data/store.json`). Without it, hosts with temporary storage erase orders when the service restarts.
5. Open the live address, go to `/manager/` and log in.
6. In the manager page click **Print table QR codes**, print them and put one on each table. HTTPS is required for phone notifications and is provided by these hosts automatically.

A small VPS also works: run `node server.js` under `pm2` or systemd and put Caddy or Nginx in front for HTTPS. For Nginx, keep response buffering off for `/api/manager/stream`.

## How the manager gets orders

The manager page keeps one live connection open to the server. When a guest sends an order or presses Call waiter, the server pushes it to every logged-in manager screen within a second, with an optional sound and a browser notification. The manager page must stay open on a phone or a counter tablet (keep the screen awake). Alerts while the phone is locked or the browser is closed need push notifications or WhatsApp, which are not included yet.

## Changing the menu

Edit `menu.json` (name, price, category, `veg` 1 or 0, prep minutes, description) and restart. Sold-out switches and Wi-Fi details are changed live from the manager page.

## Safety built in

- Prices are always taken from `menu.json` on the server, never from the guest's phone.
- Wi-Fi details are only sent to a table that has a real open order.
- Manager routes need a signed login cookie. Login attempts, orders and requests are rate limited per IP.
- Orders paid or cancelled stay in the file for 60 days, then are removed.

## Files

```
server.js          the whole backend
menu.json          menu items and prices
public/index.html  page layout and styles
public/app.js      guest and manager screens
public/qr.html     printable table QR codes
```
