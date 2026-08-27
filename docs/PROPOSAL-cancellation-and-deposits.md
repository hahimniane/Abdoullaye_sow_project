# Proposal: how we take payment and handle cancellations

For stakeholders. 2026-08-10. Answers the open refund questions in section 3
of the pre-launch meeting notes.

---

## The problem

Today a customer pays the full amount the moment they book.

If they cancel, we send the money back — but **Stripe keeps its fee**. Refund
a $110 barrel and about $3.50 is gone for good, on a sale that never happened.
Multiply that by every cancellation.

There is a second problem. A business saves a place for that customer and
protects it for weeks. If the customer walks away three days before shipping,
the business cannot refill the slot. Right now the business absorbs that
entirely.

## What we propose

**Take the money closer to the day the work happens.**

**If the service is soon (under a week):** we reserve the money on the card
instead of taking it, the way a hotel does. If the customer cancels, we release
it. No money moves, no fee is lost, nothing to refund.

**If the service is further out:** banks will not hold a reservation longer
than 7 days — it expires by itself. So instead:

| When | What happens |
| --- | --- |
| Customer books | Pays a **deposit** |
| Cancels early | Deposit **returned** |
| Shortly before the service | Pays the **rest** |
| Cancels late | Business **keeps the deposit** |

Example — a $220 barrel order with a 25% deposit: $55 at booking, $165 later.
Cancel late and the business keeps the $55 for the empty slot.

## Why a deposit

It is the customer having something at risk too, not only the business. It is
what pays for a place that was held and then lost. Airlines, hotels and car
rental all work this way, and customers understand it.

## Each business sets its own numbers

We do not pick these centrally. **Each business decides its own deposit and its
own cancellation deadline**, because only the operator knows what an empty slot
costs and how late they can still refill it. A business can also set different
numbers for different services — freight and barrels do not have to match.

The platform only sets outer limits so nobody asks for something unreasonable:
a deposit cannot exceed half the order, and free cancellation cannot end more
than 30 days before the service.

A business that wants no deposit at all simply leaves it blank.

## The customer always sees it first

Before paying, on the screen, in plain words:

> Free cancellation until 3 March. After that, cancelling costs you $55.

This is what makes the fee fair, and it is why nobody argues with hotels about
it.

## What this fixes

- We stop burning card fees on sales that never happen.
- Businesses stop absorbing the cost of last-minute cancellations alone.
- Transport gets the refund rules it has been blocked on (section 3), and can
  launch with a payment step instead of view-only.
- Customers keep their money longer and know the terms before they pay.

## What we need from you

1. **When a customer cancels inside the free window and we return the deposit,
   the card fee is still lost. Who absorbs it — the platform or the business?**
   This is the only decision blocking the build.
2. Confirm businesses setting their own deposits and deadlines is what you
   want, rather than one platform-wide rule.

## Status

The settings layer is built and tested. Nothing charges money yet. Once
question 1 is answered we can build the payment flow and the business screens.

Shared barrels are excluded — they stay retired, as agreed.
