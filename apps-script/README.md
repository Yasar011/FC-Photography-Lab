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

## Updating the script (needed after the switch to the free Spark plan)
The website now sends a proof of who is signed in instead of a secret. The new `Code.gs` checks that proof, reads the booking itself, and only emails people connected to the booking or admins.
1. Open the Google Sheet and click **Extensions → Apps Script**.
2. Replace everything in `Code.gs` with the new [`Code.gs`](Code.gs) and save.
3. Click **Deploy → Manage deployments → ✏️ Edit**, set **Version: New version**, then click **Deploy**. The URL stays the same.
4. Run `setup` once if you haven't, and keep **TEST MODE** on until you are happy. Then run `goLive`.

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

### Copy of every email to the sheet owner
In live mode, the sheet owner (fc.jodhpur@nift.ac.in) gets a **hidden copy (BCC)** of every email, inside the same conversation. Run **`stopCopies`** to turn this off and **`sendCopies`** to turn it back on. Set the `COPY_TO` script property to send the copies to a different address.

### Daily summary to the FC-CC (about 4:15 PM)
Every day at about 4:15 PM the FC-CC and the Main Admin get one email listing:
- bookings waiting for approval, marked **TODAY** when they're today;
- special bookings ready for final approval;
- faculty concerns;
- for information: bookings waiting for the FC student, and special forms not yet printed.

Set it up once:
1. Open the Firebase service-account key file in Notepad and copy everything.
2. In Apps Script, go to **Project Settings ⚙️ → Script properties → Add script property**. Name it `SA_JSON` and paste the copied text as the value. Save.
3. Choose **`setupDailySummary`**, click **▶ Run**, and allow the permissions.
4. Optional: choose **`dailySummary`** and click **▶ Run** to get one now.

The key stays in the script's private settings, so only people who can edit this Apps Script project can see it.

### Test mode → live

After `setup`, the script is in **TEST MODE**: every email goes to **you**, with the real recipient shown in the subject (`[TEST → student@nift.ac.in] …`).
When everything looks right, run **`goLive`** to email real students and faculty. Run **`backToTestMode`** to switch back.

Optional script properties (Project Settings → Script properties):
`TEST_EMAIL` (where test emails go), `SENDER_NAME`, `REPLY_TO`.

### Notes
- Gmail limits: about **100 emails/day** for a personal Gmail account and **1,500/day** for a Google Workspace (`@nift.ac.in`) account. Use the official FC/NIFT account to own the sheet.
- The SECRET stops anyone else from using the web app. If it leaks, delete the `SECRET` script property and run `setup` again to make a new one. Then update `functions/.env`.
- If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.
