# Emails + booking register with Google Sheets (Apps Script)

With this, the booking system sends all its emails through **your Google Sheet**:

| Who | Emails |
|---|---|
| Student | Booking submitted (application) · sent to FC-CC · FC student approved/rejected · form issued · **approved (confirmation)** · rejected · cancelled |
| FC student / senior | Approval request · you were added as senior |
| Faculty | Booking information with an **"I DID NOT APPROVE THIS"** button |
| FC-CC | Booking waiting for approval · faculty concern |

The sheet also keeps **one live row per booking** in the **Bookings** tab, updated on every change.
When a faculty member presses **I DID NOT APPROVE THIS**, that booking's row turns **red** until the FC-CC decides. After that, the *Faculty response* cell stays red.
Every email is listed in the **Emails** tab.

## Setup (about 5 minutes)

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Delete what is in `Code.gs` and paste [`Code.gs`](Code.gs) from this folder. Save.
3. In the function list at the top, choose **`setup`** → **Run** → allow the permissions (Sheets + send email as you).
   Open **Execution log** and copy the **SECRET** it prints.
4. Choose **`sendTest`** → **Run**. You get a test email, and two sample rows appear in **Bookings**, one of them red. Delete those rows afterwards.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy** → copy the **Web app URL**.
6. In `functions/.env.<project-id>` (never commit this file) add:
   ```
   SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXX/exec
   SHEETS_WEBHOOK_SECRET=<the SECRET from step 3>
   ```
   then deploy the functions again. SMTP is not needed. If the deploy asks for `SMTP_PASS`, enter any value, such as `unused`.

### Test mode → live

After `setup`, the script is in **TEST MODE**: every email goes to **you**, with the real recipient shown in the subject (`[TEST → student@nift.ac.in] …`).
When everything looks right, run **`goLive`** to email real students and faculty. Run **`backToTestMode`** to switch back.

Optional script properties (Project Settings → Script properties):
`TEST_EMAIL` (where test emails go), `SENDER_NAME`, `REPLY_TO`.

### Notes
- Gmail limits: about **100 emails/day** for a personal Gmail account and **1,500/day** for a Google Workspace (`@nift.ac.in`) account. Use the official FC/NIFT account to own the sheet.
- The SECRET stops anyone else from using the web app. If it leaks, delete the `SECRET` script property and run `setup` again to make a new one. Then update `functions/.env`.
- If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.
