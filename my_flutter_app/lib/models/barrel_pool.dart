import 'package:cloud_firestore/cloud_firestore.dart';

class BarrelPool {
  const BarrelPool({
    required this.id,
    required this.businessId,
    required this.businessName,
    required this.destinationCountryId,
    required this.destinationCountryName,
    required this.totalShares,
    required this.openShares,
    required this.pricePerShare,
    required this.depositPerShare,
    required this.status,
    this.origin = 'customerPosted',
    this.holderRole = 'customer',
    this.approvalMode = 'approval',
    this.shipMode = 'sea',
    this.joinDeadline,
    this.trackingCode = '',
    this.participantRole = '',
    this.participantJoinStatus = '',
    this.participantPaymentStatus = '',
    this.balancePaymentStatus = '',
    this.balanceDueAmount = 0,
    this.balancePaymentRequestId = '',
  });

  final String id;
  final String businessId;
  final String businessName;
  final String destinationCountryId;
  final String destinationCountryName;
  final int totalShares;
  final int openShares;
  final double pricePerShare;
  final double depositPerShare;
  final String status;
  final String origin;
  final String holderRole;
  final String approvalMode;
  final String shipMode;
  final DateTime? joinDeadline;
  final String trackingCode;
  final String participantRole;
  final String participantJoinStatus;
  final String participantPaymentStatus;
  final String balancePaymentStatus;
  final double balanceDueAmount;
  final String balancePaymentRequestId;

  factory BarrelPool.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};
    return BarrelPool(
      id: doc.id,
      businessId: (data['businessId'] ?? '') as String,
      businessName: (data['businessName'] ?? '') as String,
      destinationCountryId: (data['destinationCountryId'] ?? '') as String,
      destinationCountryName: (data['destinationCountryName'] ?? '') as String,
      totalShares: (data['totalShares'] as num?)?.toInt() ?? 0,
      openShares:
          (data['sharesAvailable'] as num?)?.toInt() ??
          (data['openShares'] as num?)?.toInt() ??
          0,
      pricePerShare: (data['pricePerShare'] as num?)?.toDouble() ?? 0,
      depositPerShare: (data['depositPerShare'] as num?)?.toDouble() ?? 0,
      status: (data['status'] ?? 'open') as String,
      origin: (data['origin'] ?? 'customerPosted') as String,
      holderRole: (data['holderRole'] ?? 'customer') as String,
      approvalMode: (data['approvalMode'] ?? 'approval') as String,
      shipMode: (data['shipMode'] ?? 'sea') as String,
      joinDeadline: (data['joinDeadline'] as Timestamp?)?.toDate(),
      trackingCode: (data['trackingCode'] ?? data['poolId'] ?? '') as String,
      participantRole: (data['participantRole'] ?? '') as String,
      participantJoinStatus: (data['participantJoinStatus'] ?? '') as String,
      participantPaymentStatus:
          (data['participantPaymentStatus'] ?? '') as String,
      balancePaymentStatus: (data['balancePaymentStatus'] ?? '') as String,
      balanceDueAmount:
          (data['balanceDueAmount'] as num?)?.toDouble() ??
          ((data['balanceDueAmountCents'] as num?)?.toDouble() ?? 0) / 100,
      balancePaymentRequestId:
          (data['balancePaymentRequestId'] ?? '') as String,
    );
  }
}

class BarrelPoolBalancePaymentResult {
  const BarrelPoolBalancePaymentResult({
    required this.requestId,
    required this.poolId,
    this.amount = 0,
    this.clientSecret = '',
    this.simulatedPayment = false,
  });

  final String requestId;
  final String poolId;
  final double amount;
  final String clientSecret;
  final bool simulatedPayment;

  factory BarrelPoolBalancePaymentResult.fromMap(Map<String, dynamic> data) {
    return BarrelPoolBalancePaymentResult(
      requestId: (data['requestId'] ?? '') as String,
      poolId: (data['poolId'] ?? '') as String,
      amount: (data['amount'] as num?)?.toDouble() ?? 0,
      clientSecret: (data['clientSecret'] ?? '') as String,
      simulatedPayment: data['simulatedPayment'] == true,
    );
  }
}

class BarrelPoolResult {
  const BarrelPoolResult({
    required this.poolId,
    this.trackingCode = '',
    this.depositAmount = 0,
    this.walletAppliedAmount = 0,
    this.cardDepositAmount = 0,
    this.clientSecret = '',
    this.simulatedPayment = false,
    this.shipmentId = '',
  });

  final String poolId;
  final String trackingCode;
  final double depositAmount;
  final double walletAppliedAmount;
  final double cardDepositAmount;
  final String clientSecret;
  final bool simulatedPayment;
  final String shipmentId;

  factory BarrelPoolResult.fromMap(Map<String, dynamic> data) {
    return BarrelPoolResult(
      poolId: (data['poolId'] ?? '') as String,
      trackingCode: (data['trackingCode'] ?? '') as String,
      depositAmount: (data['depositAmount'] as num?)?.toDouble() ?? 0,
      walletAppliedAmount:
          (data['walletAppliedAmount'] as num?)?.toDouble() ?? 0,
      cardDepositAmount: (data['cardDepositAmount'] as num?)?.toDouble() ?? 0,
      clientSecret: (data['clientSecret'] ?? '') as String,
      simulatedPayment: data['simulatedPayment'] == true,
      shipmentId: (data['shipmentId'] ?? '') as String,
    );
  }
}
