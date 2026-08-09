# UI conventions

Rules we have decided to follow, and why. Written 2026-08-08.

These are not style preferences. Each one exists because something concrete
went wrong, and the note says what, so a future change can weigh the reason
rather than the rule.

---

## 1. Explain fields with an "i", not a permanent banner

**Use** `FieldInfo` (`admin_web/src/components/field-info.tsx`). It renders a
small "i" beside a label. Pressing it reveals the explanation; pressing again,
clicking away, or Escape puts it back.

```tsx
<span className="label-with-info">
  Platform fee (%)
  <FieldInfo label="what the platform fee does">
    <p>Your cut of every customer payment. A 10% fee on a $200 job keeps $20.</p>
  </FieldInfo>
</span>
```

**Why.** The console used to explain fields in permanent amber `info-band`
banners - about twenty of them. Every reader paid for them on every visit,
including the hundredth. And because the space was free, the wording drifted
into describing the implementation rather than the decision:

> A rate set here applies to one service only. Every other service keeps the
> blanket rate for this business, and services with no rate of their own fall
> back to the platform default.

That is three sentences of inheritance rules. What the reader needed was
"charge a different rate for one service; leave it empty to use the usual
rate."

**The rules:**

- The label says **what to do**. The "i" says **why, what happens, and edge
  cases**.
- **Never hide something the reader must know to avoid a mistake.** Anything
  about money moving, data being deleted, or an action that cannot be undone
  belongs on the screen. Detail on demand is for detail, not for warnings.
- **Write in the reader's terms.** "0% means you take nothing" beats "0% is a
  real rate rather than an inherited null".
- One `<p>` per idea. The bubble can be long, because nobody reads it unless
  they asked.
- A permanent one-line lede above a form (`.panel-lede`) is still fine, and
  usually better than nothing. The banner is what we are retiring, not the
  sentence.

**Still to convert:** the remaining `info-band` uses in `admin-console.tsx` and
`customer-console.tsx`. Convert them as you touch those screens rather than in
one sweep - the wording needs rethinking each time, and a mechanical
find-and-replace would just move bad copy behind an icon.

---

## 2. Group a long settings page; do not let it grow downward

Settings was eleven unrelated panels in one scroll, about 1,700 lines, with a
permissions matrix tall enough that everything below it was effectively hidden.

Group by **the question the reader is answering**, not by data type, and render
one group at a time using the console's existing `service-segments` tablist.
The current groups are Roles & access, Fees & commission, Platform, and
Notifications.

The test of a grouping is where a *new* setting would go. If the answer is
obvious, the grouping is right; if the answer is "the bottom", it is not.

---

## 3. Derive lists of features; never hand-maintain the same list twice

`admin_web/src/lib/admin-areas.ts` declares every area of the admin console
once, along with how access to it is decided. The tab list, the role editor and
the super admin's access all derive from it.

**Why.** That list used to be written out three times. Adding a feature meant
remembering all three, and forgetting the role editor was the expensive one:
the area shipped, no role could ever be granted it, and nothing said so.

**The rule:** if a list describes what the product *has*, it is declared once
and derived everywhere. If you find yourself typing the same feature name into
a second array, stop and make the first one the source.

There is a test asserting no hand-written copy has reappeared. Keep it.

---

## 4. Do not show a control that the server will refuse

Both viewing clients mirror the server's state machine and offer slightly
**less** than the server allows, never more. A button that fails when pressed
teaches people not to trust the interface.

Where the client genuinely cannot know - a listing withdrawn since the record
loaded, say - let the server's own refusal be the message and show it verbatim.
Those sentences are written to be read by a person.

---

## 5. Tabs over scrolling, once a page holds two unrelated things

Applied to: customer viewings vs orders, business viewings vs purchases, and
the settings groups above.

The signal is not length, it is **unrelatedness**. A long list of one kind of
thing is fine. Two kinds of thing stacked is where a tab belongs, because the
reader arrives wanting one of them and should not have to scroll past the
other.

When you split a list, check what the split leaves behind: filters, counts and
search that referred to the whole set now describe only part of it. Splitting
viewings out of purchases left the purchases filter still offering viewing
statuses that could no longer match anything.
