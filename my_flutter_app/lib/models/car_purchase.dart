import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/car_viewing_service.dart';

class CarPurchase {
  CarPurchase({
    required this.id,
    required this.carId,
    required this.carTitle,
    required this.buyerUid,
    required this.buyerEmail,
    required this.buyerName,
    required this.buyerPhone,
    required this.destinationCountryId,
    required this.destinationCountryName,
    this.businessId = 'keren_auto_sales',
    this.businessName = 'Keren',
    required this.depositAmount,
    required this.depositCurrency,
    required this.paymentStatus,
    required this.purchaseStatus,
    required this.createdAt,
    this.stripePaymentIntentId,
    this.paymentType,
    this.appointmentStart,
    this.appointmentLabel,
    this.staffNotes,
    this.updatedAt,
    this.holdUntilDate,
    this.holdExpiresAt,
    this.holdPricingMode,
    this.holdDays,
    this.holdRateAmount,
    this.depositForfeitureStatus,
    this.holdReviewRequiredAt,
    this.noShowAt,
    this.extensionRequestStatus,
    this.extensionRequestedHoldUntilDate,
    this.extensionExtraAmount,
    this.extensionPaymentStatus,
    this.buyerReliabilitySnapshot,
    this.proposedSlots = const <ViewingSlot>[],
    this.proposedBy,
    this.proposalRound = 0,
    this.respondByAt,
    this.viewingHistory = const <ViewingHistoryEntry>[],
  });

  static const double fixedDepositAmount = 500;
  static const String fixedDepositCurrency = 'USD';

  final String id;
  final String carId;
  final String carTitle;
  final String buyerUid;
  final String buyerEmail;
  final String buyerName;
  final String buyerPhone;
  final String destinationCountryId;
  final String destinationCountryName;
  final String businessId;
  final String businessName;
  final double depositAmount;
  final String depositCurrency;
  final String paymentStatus;
  final String purchaseStatus;
  final DateTime createdAt;
  final String? stripePaymentIntentId;
  final String? paymentType;
  final DateTime? appointmentStart;
  final String? appointmentLabel;
  final String? staffNotes;
  final DateTime? updatedAt;
  final DateTime? holdUntilDate;
  final DateTime? holdExpiresAt;
  final String? holdPricingMode;
  final int? holdDays;
  final double? holdRateAmount;
  final String? depositForfeitureStatus;
  final DateTime? holdReviewRequiredAt;
  final DateTime? noShowAt;
  final String? extensionRequestStatus;
  final DateTime? extensionRequestedHoldUntilDate;
  final double? extensionExtraAmount;
  final String? extensionPaymentStatus;
  final Map<String, dynamic>? buyerReliabilitySnapshot;

  /// The times currently on the table, empty once a time is agreed.
  final List<ViewingSlot> proposedSlots;

  /// Who put them there, so a card can say "you proposed" or "they offered".
  final ViewingParty? proposedBy;

  /// How many proposals this negotiation has already carried. The server stops
  /// accepting counters after [maxViewingProposalRounds].
  final int proposalRound;

  /// When the party being waited on must answer by.
  final DateTime? respondByAt;

  /// The audit trail, oldest first.
  final List<ViewingHistoryEntry> viewingHistory;

  bool get isViewingReservation {
    return paymentType == 'viewing_reservation' ||
        (appointmentStart != null && depositAmount == 0);
  }

  bool get isActiveViewingReservation {
    return isViewingReservation &&
        purchaseStatus != 'cancelled' &&
        purchaseStatus != 'completed';
  }

  /// Exactly what `decideViewingAction` reads, so the screens can ask
  /// [availableViewingActions] what to offer instead of branching on the
  /// status themselves.
  ViewingState get viewingState => ViewingState(
    purchaseStatus: purchaseStatus,
    proposedSlots: proposedSlots,
    proposedBy: proposedBy,
    proposalRound: proposalRound,
    respondByAt: respondByAt,
    appointmentStart: appointmentStart,
    appointmentLabel: appointmentLabel ?? '',
    history: viewingHistory,
  );

  /// Whether the appointment has not happened and something can still change.
  ///
  /// Narrower than [isActiveViewingReservation], which mirrors the server's
  /// "one viewing per listing" guard and so still counts a declined or expired
  /// record: those are closed conversations with no actions left in them, but
  /// they do still block a second request for the same car.
  bool get hasOpenViewingNegotiation =>
      isViewingReservation && viewingState.isOpen;

  bool get isPaidHold => paymentType == 'reservation_deposit';

  bool get canRequestHoldExtension {
    if (!isPaidHold) return false;
    if (purchaseStatus == 'completed' ||
        purchaseStatus == 'no_show' ||
        purchaseStatus == 'cancelled' ||
        purchaseStatus == 'refunded' ||
        purchaseStatus == 'forfeited') {
      return false;
    }
    return extensionRequestStatus != 'pending' &&
        extensionRequestStatus != 'approved';
  }

  bool get canPayApprovedExtension {
    return isPaidHold && extensionRequestStatus == 'approved';
  }

  factory CarPurchase.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return CarPurchase.fromMap(doc.id, data);
  }

  factory CarPurchase.fromMap(String id, Map<String, dynamic> data) {
    return CarPurchase(
      id: id,
      carId: (data['carId'] ?? '') as String,
      carTitle: (data['carTitle'] ?? '') as String,
      buyerUid: (data['buyerUid'] ?? '') as String,
      buyerEmail: (data['buyerEmail'] ?? '') as String,
      buyerName: (data['buyerName'] ?? '') as String,
      buyerPhone: (data['buyerPhone'] ?? '') as String,
      destinationCountryId:
          (data['destinationCountryId'] ?? 'guinea') as String,
      destinationCountryName:
          (data['destinationCountryName'] ?? 'Guinea') as String,
      businessId: (data['businessId'] ?? 'keren_auto_sales') as String,
      businessName: (data['businessName'] ?? 'Keren') as String,
      depositAmount: _parseDouble(data['depositAmount']),
      depositCurrency:
          (data['depositCurrency'] ?? fixedDepositCurrency) as String,
      paymentStatus: (data['paymentStatus'] ?? 'pending') as String,
      purchaseStatus: (data['purchaseStatus'] ?? 'pending') as String,
      createdAt: _toDateTime(data['createdAt']) ?? DateTime.now(),
      stripePaymentIntentId: data['stripePaymentIntentId'] as String?,
      paymentType: data['paymentType'] as String?,
      appointmentStart: _toDateTime(data['appointmentStart']),
      appointmentLabel: data['appointmentLabel'] as String?,
      staffNotes: data['staffNotes'] as String?,
      updatedAt: _toDateTime(data['updatedAt']),
      holdUntilDate: _toDateTime(data['holdUntilDate']),
      holdExpiresAt: _toDateTime(data['holdExpiresAt']),
      holdPricingMode: data['holdPricingMode'] as String?,
      holdDays: data['holdDays'] is num
          ? (data['holdDays'] as num).toInt()
          : int.tryParse('${data['holdDays'] ?? ''}'),
      holdRateAmount: data['holdRateAmount'] == null
          ? null
          : _parseDouble(data['holdRateAmount']),
      depositForfeitureStatus: data['depositForfeitureStatus'] as String?,
      holdReviewRequiredAt: _toDateTime(data['holdReviewRequiredAt']),
      noShowAt: _toDateTime(data['noShowAt']),
      extensionRequestStatus: data['extensionRequestStatus'] as String?,
      extensionRequestedHoldUntilDate: _toDateTime(
        data['extensionRequestedHoldUntilDate'],
      ),
      extensionExtraAmount: data['extensionExtraAmount'] == null
          ? null
          : _parseDouble(data['extensionExtraAmount']),
      extensionPaymentStatus: data['extensionPaymentStatus'] as String?,
      buyerReliabilitySnapshot:
          data['buyerReliabilitySnapshot'] is Map<String, dynamic>
          ? Map<String, dynamic>.from(data['buyerReliabilitySnapshot'] as Map)
          : null,
      proposedSlots: viewingSlotsFromStored(data['proposedSlots']),
      proposedBy: viewingPartyFromWire(data['proposedBy']),
      proposalRound: data['proposalRound'] is num
          ? (data['proposalRound'] as num).toInt()
          : int.tryParse('${data['proposalRound'] ?? ''}') ?? 0,
      respondByAt: _toDateTime(data['respondByAt']),
      viewingHistory: viewingHistoryFromStored(data['viewingHistory']),
    );
  }

  static double _parseDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }

  static DateTime? _toDateTime(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return null;
  }
}
