1. SEND SMS
https://sms.arkesel.com/api/v2/sms/send
This operation is used to send SMS to a single phone number or multiple phone numbers.
```json
{
  "sender": "Arkesel",
  "message": "Hello world. Spreading peace and joy only. Remember to put on your face mask. Stay safe!",
  "recipients": [
    "233544919953",
    "233544919953"
  ]
}
```
Response samples for Send SMS

```json
{
  "status": "success",
  "data": [
    {
      "recipient": "233544919953",
      "id": "9b752841-7ee7-4d40-b4fe-768bfb1da4f0"
    },
    {
      "recipient": "233544919953",
      "id": "7ea01acd-485c-4df3-b646-e9e24430e145"
    },
    {
      "invalid numbers": [
        "22354674948"
      ]
    }
  ]
}
```



2. SCHEDULE SMS
https://sms.arkesel.com/api/v2/sms/send
This operation is used to schedule SMS to a single phone number or multiple phone numbers.
```json
{
  "sender": "Arkesel",
  "message": "Hello world. Spreading peace and joy only. Remember to put on your face mask. Stay safe!",
  "recipients": [
    "233544919953",
    "233544919953"
  ],
  "scheduled_date": "2021-04-09 07:30 AM"
}
```
Response samples for Schedule SMS

```json
{
  "status": "success",
  "message": "SMS request sent successfully!"
}
```


3. SEND SMS WITH DELIVERY WEBHOOK
https://sms.arkesel.com/api/v2/sms/send
This operation is used to send SMS and request a delivery report using a delivery webhook. The system pushes the delivery status of the message to the webhook.
```json 
{
  "sender": "Arkesel",
  "message": "Hello world. Spreading peace and joy only. Remember to put on your face mask. Stay safe!",
  "recipients": [
    "233544919953",
    "233544919953"
  ],
  "callback_url": "https://webhook.site/sms/delivery_webhook"
}
```

Response samples for Send SMS with Delivery Webhook

```json
{
  "status": "success",
  "data": [
    {
      "recipient": "233544919953",
      "id": "9b752841-7ee7-4d40-b4fe-768bfb1da4f0"
    },
    {
      "recipient": "233544919953",
      "id": "7ea01acd-485c-4df3-b646-e9e24430e145"
    }
  ]
}
```



4. SEND SANDBOXED SMS
https://sms.arkesel.com/api/v2/sms/send
This operation is used to send a test SMS request to the system. You are not billed for this operation. Messages sent in a sandboxed environment are not forwarded to the mobile network providers for delivery. Sandbox messages can only be seen from the SMS history report. This is a great environment to test your application without any cost.
```json
{
  "sender": "Arkesel",
  "message": "Hello world. Spreading peace and joy only. Remember to put on your face mask. Stay safe!",
  "recipients": [
    "233544919953",
    "233544919953"
  ],
  "sandbox": true
}
```


## Send SMS using Template
https://sms.arkesel.com/api/v2/sms/template/send
This operation is used to send variable SMS to recipients.
```json 
{
  "sender": "Arkesel",
  "message": "Hello <%name%>, have a safe journey to <%city%>. Stay safe!",
  "recipients": {
    "233553995047": {
      "name": "Josh",
      "city": "Accra"
    },
    "233544919953": {
      "name": "Joel",
      "city": "Beinjin"
    }
  }
}
```

Response samples for Send SMS using Template

```json
{
  "status": "success",
  "data": [
    {
      "recipient": "233544919953",
      "id": "9b752841-7ee7-4d40-b4fe-768bfb1da4f0"
    },
    {
      "recipient": "233544919953",
      "id": "7ea01acd-485c-4df3-b646-e9e24430e145"
    }
  ]
}
```

## Check balance
https://sms.arkesel.com/api/v2/clients/balance-details
Check an account balance be it SMS or Main balance.

```js
const axios = require('axios');

const config = {
  method: 'get',
  url: 'https://sms.arkesel.com/api/v2/clients/balance-details',
  headers: {
    'api-key': 'cE9QRUkdjsjdfjkdsj9kdiieieififiw='
  }
};

axios(config)
.then(function (response) {
  console.log(JSON.stringify(response.data));
})
.catch(function (error) {
  console.log(error);
});

```

Response samples
```json
{
  "status": "success",
  "data": {
    "sms_balance": "2003",
    "main_balance": "GHS 20.99"
  }
}
```

## SMS details
https://sms.arkesel.com/api/v2/sms
Get the details of a sent SMS such as delivery status, recipient, sender etc., using its UUID.

```js
const axios = require('axios');

const config = {
  method: 'get',
  url: 'https://sms.arkesel.com/api/v2/sms/f3be70c1-3545-4677-b607-6b5f32202652',
  headers: {
    'api-key': 'cE9QRUkdjsjdfjkdsj9kdiieieififiw='
  }
};

axios(config)
.then(function (response) {
  console.log(JSON.stringify(response.data));
})
.catch(function (error) {
  console.log(error);
});
```

Response samples
```json
{
  "status": "success",
  "data": {
    "ID": "f3be70c1-3545-4677-b607-6b5f32202652",
    "status": "DELIVERED",
    "sender": "Arkesel",
    "recipient": "233544919953",
    "message": "Welcome to version 2 of our API!",
    "message_count": 1,
    "sent_at_time": "2021-04-09 18:44:05"
  }
}
```