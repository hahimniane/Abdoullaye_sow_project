import 'package:cloud_firestore/cloud_firestore.dart';

class SupportCase {
  const SupportCase({
    required this.id,
    required this.customerUid,
    required this.customerName,
    required this.customerEmail,
    required this.customerPhone,
    required this.businessId,
    required this.businessName,
    required this.relatedCollection,
    required this.relatedId,
    required this.relatedLabel,
    required this.caseType,
    required this.subject,
    required this.status,
    required this.priority,
    required this.escalationStatus,
    this.escalationReason,
    this.assignedBusinessUserId,
    this.assignedAdminUid,
    this.lastMessage = '',
    this.lastMessageSenderRole = '',
    this.outcome,
    this.resolutionNote,
    this.businessResponseDueAt,
    this.escalationAvailableAt,
    this.escalatedAt,
    this.lastMessageAt,
    this.lastCustomerMessageAt,
    this.lastBusinessMessageAt,
    this.lastAdminMessageAt,
    this.resolvedAt,
    this.closedAt,
    this.reopenedAt,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String customerUid;
  final String customerName;
  final String customerEmail;
  final String customerPhone;
  final String businessId;
  final String businessName;
  final String relatedCollection;
  final String relatedId;
  final String relatedLabel;
  final String caseType;
  final String subject;
  final String status;
  final String priority;
  final String escalationStatus;
  final String? escalationReason;
  final String? assignedBusinessUserId;
  final String? assignedAdminUid;
  final String lastMessage;
  final String lastMessageSenderRole;
  final String? outcome;
  final String? resolutionNote;
  final DateTime? businessResponseDueAt;
  final DateTime? escalationAvailableAt;
  final DateTime? escalatedAt;
  final DateTime? lastMessageAt;
  final DateTime? lastCustomerMessageAt;
  final DateTime? lastBusinessMessageAt;
  final DateTime? lastAdminMessageAt;
  final DateTime? resolvedAt;
  final DateTime? closedAt;
  final DateTime? reopenedAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get isEscalated => escalationStatus == 'escalated';
  bool get isResolved => status == 'resolved' || status == 'closed';
  bool get isUrgent => priority == 'urgent' || priority == 'blocked';

  bool get escalationAvailable {
    if (isEscalated) return false;
    final availableAt = escalationAvailableAt;
    return availableAt == null || !availableAt.isAfter(DateTime.now());
  }

  factory SupportCase.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return SupportCase.fromMap(doc.id, data);
  }

  factory SupportCase.fromMap(String id, Map<String, dynamic> data) {
    return SupportCase(
      id: id,
      customerUid: (data['customerUid'] ?? '') as String,
      customerName: (data['customerName'] ?? '') as String,
      customerEmail: (data['customerEmail'] ?? '') as String,
      customerPhone: (data['customerPhone'] ?? '') as String,
      businessId: (data['businessId'] ?? '') as String,
      businessName: (data['businessName'] ?? '') as String,
      relatedCollection: (data['relatedCollection'] ?? '') as String,
      relatedId: (data['relatedId'] ?? '') as String,
      relatedLabel: (data['relatedLabel'] ?? '') as String,
      caseType: (data['caseType'] ?? '') as String,
      subject: (data['subject'] ?? '') as String,
      status: (data['status'] ?? 'open') as String,
      priority: (data['priority'] ?? 'normal') as String,
      escalationStatus:
          (data['escalationStatus'] ?? 'business_first') as String,
      escalationReason: data['escalationReason'] as String?,
      assignedBusinessUserId: data['assignedBusinessUserId'] as String?,
      assignedAdminUid: data['assignedAdminUid'] as String?,
      lastMessage: (data['lastMessage'] ?? '') as String,
      lastMessageSenderRole: (data['lastMessageSenderRole'] ?? '') as String,
      outcome: data['outcome'] as String?,
      resolutionNote: data['resolutionNote'] as String?,
      businessResponseDueAt: _toDateTime(data['businessResponseDueAt']),
      escalationAvailableAt: _toDateTime(data['escalationAvailableAt']),
      escalatedAt: _toDateTime(data['escalatedAt']),
      lastMessageAt: _toDateTime(data['lastMessageAt']),
      lastCustomerMessageAt: _toDateTime(data['lastCustomerMessageAt']),
      lastBusinessMessageAt: _toDateTime(data['lastBusinessMessageAt']),
      lastAdminMessageAt: _toDateTime(data['lastAdminMessageAt']),
      resolvedAt: _toDateTime(data['resolvedAt']),
      closedAt: _toDateTime(data['closedAt']),
      reopenedAt: _toDateTime(data['reopenedAt']),
      createdAt: _toDateTime(data['createdAt']),
      updatedAt: _toDateTime(data['updatedAt']),
    );
  }

  static DateTime? _toDateTime(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return null;
  }
}

class SupportCaseOpenRequest {
  const SupportCaseOpenRequest({
    required this.relatedCollection,
    required this.relatedId,
    required this.subject,
    this.message,
    this.priority = 'normal',
  });

  final String relatedCollection;
  final String relatedId;
  final String subject;
  final String? message;
  final String priority;

  Map<String, dynamic> toJson() {
    return {
      'relatedCollection': relatedCollection,
      'relatedId': relatedId,
      'subject': subject,
      if (message != null && message!.trim().isNotEmpty)
        'message': message!.trim(),
      'priority': priority,
    };
  }
}
