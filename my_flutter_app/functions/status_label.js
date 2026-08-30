// A status value is a database enum, not a sentence. Interpolating one raw
// put "awaiting_weight_confirmation" in a customer's notification; every
// notification body must run the status through this first.
function humanStatusLabel(status, fallback = "updated") {
  const cleaned = String(status || "").trim().replace(/_/g, " ");
  return cleaned || fallback;
}

module.exports = {humanStatusLabel};
