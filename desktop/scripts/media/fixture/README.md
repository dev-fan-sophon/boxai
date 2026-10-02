# Lotus Travel

A fictional Vietnam travel project used for public BoxAI Desktop demos.
There are no real bookings, customers, payment credentials or services.

## Tours

| Tour | Duration | Price per traveller |
| --- | --- | --- |
| Hanoi Old Quarter walk | 3 hours | 800,000 VND |
| Da Nang local food tour | 4 hours | 1,200,000 VND |
| Hoi An lantern workshop | 2 hours | 600,000 VND |

All prices are listed in VND. The first traveller pays the full price; each
additional traveller receives a 10% discount. A booking accepts 1–8 travellers.

## Development

Node.js 22 or newer; no third-party dependencies. Run `npm test`.
The initial quote implementation intentionally lacks the group discount and
count validation so a real agent can implement and test them during the demo.
