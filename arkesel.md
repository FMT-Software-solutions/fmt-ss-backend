**Arkesel** is a major cloud communications provider in Ghana that specializes in Bulk SMS, USSD, Voice SMS, and OTP (One-Time Password) services. It is extremely popular in the region because of its reliability, simple REST API, and support for local networks (like MTN, Vodafone, and AirtelTigo).

Here is a breakdown of how it works and what you need to know to integrate it into ChurchHub360:

### 1. How Arkesel SMS Works (The Flow)
To send a message using Arkesel, your application essentially acts as the middleman between your church administrators and the Arkesel servers. 
1. **Request:** When a user clicks "Send" in your app, your Node.js/Vite backend makes an HTTP `POST` request to Arkesel's API endpoint (`https://sms.arkesel.com/api/v2/sms/send`).
2. **Authentication:** You pass an API Key (generated from your Arkesel dashboard) in the HTTP headers (`api-key: YOUR_API_KEY`).
3. **Payload:** You send a JSON body containing:
   - `sender`: The registered Sender ID (e.g., "ChurchHub", max 11 characters).
   - `message`: The actual text message.
   - `recipients`: An array of phone numbers (e.g., `["23354XXXXXXX"]`).
4. **Delivery:** Arkesel processes the request and routes the SMS directly to the recipients' mobile networks.

### 2. Key Features for ChurchHub360
- **Bulk Sending:** You can send a single message to an array of hundreds or thousands of numbers in one API call. This is perfect for the "Groups" and "Tags" selections we just built.
- **Dynamic Sender IDs:** You can register specific Sender IDs (like the name of the specific church branch using your software) so members know exactly who the message is from.
- **Delivery Webhooks:** Arkesel allows you to set up a "Callback URL". When a message is successfully delivered to a member's phone, Arkesel will ping your server. You can use this to update the message status from `sent` to `delivered` in your `communication_history` database.
- **Scheduling:** They support scheduling messages for the future by passing a `scheduledDate` parameter in the API.

### 3. Pricing and Phone Numbers
- **Phone Number Format:** Arkesel is quite flexible. For Ghanaian numbers, you can send them with or without the country code (e.g., both `0544919953` and `233544919953` are valid). 
- **Cost:** SMS charges are per message segment (usually 160 characters per segment). This is exactly why we added that `150 character` warning in the UI—to help churches avoid accidentally paying for double segments.

### 4. Integration Requirements for Us
To get this working in the app, we will eventually need:
1. An **Arkesel API Key** stored securely in your `.env` variables.
2. A **Server-Side Function (Edge Function or Node API)**: Since we cannot expose API keys in the frontend React code (for security reasons), we will need to create a Supabase Edge Function or a backend route that actually makes the `axios.post()` call to Arkesel.
3. **Webhook Endpoint:** To capture delivery receipts.

It's a very straightforward API! When you are ready to actually wire up the "Confirm & Send" button to send real texts, we just need to write a small Supabase Edge Function that takes the phone numbers from our RPC query and fires them off to Arkesel.