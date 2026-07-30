function cleanString(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function publicParkingOption(option) {
  const data = option || {};
  return {
    businessId: cleanString(data.businessId, 160),
    businessName: cleanString(data.businessName),
    city: cleanString(data.city),
    address: cleanString(data.city),
    availableSpaces: Math.max(
        0,
        Math.trunc(finiteNumber(data.availableSpaces)),
    ),
    dailyRate: Math.max(0, finiteNumber(data.dailyRate)),
    weeklyRate: Math.max(0, finiteNumber(data.weeklyRate)),
    monthlyRate: Math.max(0, finiteNumber(data.monthlyRate)),
    pickupAvailable: data.pickupAvailable === true,
    pickupFee: Math.max(0, finiteNumber(data.pickupFee)),
    minimumDays: Math.max(1, Math.trunc(finiteNumber(data.minimumDays, 1))),
    instructions: cleanString(data.instructions, 1000),
    distanceMiles: Number.isFinite(Number(data.distanceMiles)) ?
      Number(data.distanceMiles) :
      null,
    estimatedTotal: Math.max(0, finiteNumber(data.estimatedTotal)),
    reviewCount: Math.max(0, Math.trunc(finiteNumber(data.reviewCount))),
    reviewAverage: Math.max(0, finiteNumber(data.reviewAverage)),
    reviewWeightedScore: Math.max(0, finiteNumber(data.reviewWeightedScore)),
  };
}

function publicOpenBarrelOption(id, pool) {
  const data = pool || {};
  return {
    id: cleanString(id, 160),
    poolId: cleanString(id, 160),
    businessId: cleanString(data.businessId, 160),
    businessName: cleanString(data.businessName),
    destinationCountryId: cleanString(data.destinationCountryId, 160),
    destinationCountryName: cleanString(data.destinationCountryName),
    sharesAvailable: Math.max(
        0,
        Math.trunc(finiteNumber(data.sharesAvailable)),
    ),
    totalShares: Math.max(0, Math.trunc(finiteNumber(data.totalShares))),
    pricePerShare: Math.max(0, finiteNumber(data.pricePerShare)),
    depositPerShare: Math.max(0, finiteNumber(data.depositPerShare)),
    currency: cleanString(data.currency || "usd", 12),
    shipMode: cleanString(data.shipMode || "sea", 20),
    joinDeadline: data.joinDeadline || null,
    origin: cleanString(data.origin || "customerPosted", 40),
    holderRole: cleanString(data.holderRole || "customer", 40),
    approvalMode: cleanString(data.approvalMode || "approval", 40),
    status: "open",
    reviewCount: Math.max(0, Math.trunc(finiteNumber(data.reviewCount))),
    reviewAverage: Math.max(0, finiteNumber(data.reviewAverage)),
    reviewWeightedScore: Math.max(0, finiteNumber(data.reviewWeightedScore)),
  };
}

module.exports = {
  publicOpenBarrelOption,
  publicParkingOption,
};
