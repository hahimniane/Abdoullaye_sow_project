"use strict";

// Order-type label surfaced to customers/businesses for a review.
const ORDER_TYPE_BY_COLLECTION = {
  carPurchases: "car",
  barrelShipments: "barrel",
  freightShipments: "freight",
  transportRequests: "transport",
  parkedCars: "parking",
};

// Mirrors the owner-uid lookup order already used by each collection's
// onDocumentUpdated notification trigger in index.js, so "does this order
// belong to the caller" agrees with "who gets notified about it."
const OWNER_UID_FIELDS_BY_COLLECTION = {
  carPurchases: ["buyerUid", "customerUid", "uid"],
  barrelShipments: ["customerUid", "senderUid", "uid"],
  freightShipments: ["customerUid", "senderUid", "uid"],
  transportRequests: ["customerUid"],
  parkedCars: ["customerUid", "ownerUid", "uid"],
};

function cleanText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

// Mirrors CustomerOrder.normalizeStatus in
// my_flutter_app/lib/models/customer_order.dart — keep the two in sync so
// "is this order completed" agrees on both the client and the server.
function normalizeOrderStatus(raw) {
  switch (raw) {
    case "in_transit":
      return "inTransit";
    case "completed":
    case "sold":
    case "paid":
    case "succeeded":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "refunded":
    case "refund_pending":
      return "refunded";
    case "active":
    case "reserved":
    case "hold":
      return "active";
    default:
      return "pending";
  }
}

// Mirrors each CustomerOrder.fromXxx factory's statusRaw derivation in
// customer_order.dart, so the same raw document reads as the same status on
// both sides.
function statusFieldsByCollection(data, relatedCollection) {
  const d = data || {};
  switch (relatedCollection) {
    case "carPurchases":
      return cleanText(d.purchaseStatus) || cleanText(d.paymentStatus);
    case "parkedCars":
      return cleanText(d.status) || cleanText(d.paymentStatus);
    default:
      return cleanText(d.status);
  }
}

function reviewDocId(relatedCollection, relatedId) {
  return `${relatedCollection}_${relatedId}`;
}

function validateReviewSubmission({rating, comment}) {
  const missing = [];
  const numericRating = Math.trunc(Number(rating));
  if (
    !Number.isFinite(numericRating) ||
    numericRating !== Number(rating) ||
    numericRating < 1 ||
    numericRating > 5
  ) {
    missing.push("a rating between 1 and 5");
  }
  const cleanComment = cleanText(comment, 1000);
  if (!cleanComment) missing.push("a comment");
  return {missing, rating: numericRating, comment: cleanComment};
}

function validateFlagSubmission({reason}) {
  const cleanReason = cleanText(reason, 300);
  const missing = cleanReason ? [] : ["a reason"];
  return {missing, reason: cleanReason};
}

// Bayesian-damped rating: a business needs roughly BAYESIAN_PRIOR_WEIGHT
// reviews before its own average dominates the platform-wide prior, so one
// 5-star review can't outrank an established business with hundreds of
// 4-star reviews.
const BAYESIAN_PRIOR_MEAN = 3.8;
const BAYESIAN_PRIOR_WEIGHT = 8;

function computeAggregate({reviewCount, reviewRatingSum}) {
  const count = Math.max(0, Math.trunc(Number(reviewCount) || 0));
  const sum = Math.max(0, Number(reviewRatingSum) || 0);
  const average = count > 0 ? sum / count : 0;
  const weightedScore =
    (BAYESIAN_PRIOR_WEIGHT * BAYESIAN_PRIOR_MEAN + sum) /
    (BAYESIAN_PRIOR_WEIGHT + count);
  return {
    reviewCount: count,
    reviewRatingSum: sum,
    reviewAverage: Math.round(average * 10) / 10,
    reviewWeightedScore: Math.round(weightedScore * 1000) / 1000,
  };
}

module.exports = {
  ORDER_TYPE_BY_COLLECTION,
  OWNER_UID_FIELDS_BY_COLLECTION,
  BAYESIAN_PRIOR_MEAN,
  BAYESIAN_PRIOR_WEIGHT,
  normalizeOrderStatus,
  statusFieldsByCollection,
  reviewDocId,
  validateReviewSubmission,
  validateFlagSubmission,
  computeAggregate,
};
