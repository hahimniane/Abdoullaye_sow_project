import 'package:cloud_firestore/cloud_firestore.dart';

class SupportReplyReference {
  const SupportReplyReference({
    required this.messageId,
    required this.senderName,
    required this.content,
  });

  final String messageId;
  final String senderName;
  final String content;

  factory SupportReplyReference.fromMap(Map<String, dynamic> data) {
    return SupportReplyReference(
      messageId: (data['messageId'] ?? data['message_id'] ?? '') as String,
      senderName: (data['senderName'] ?? data['sender_name'] ?? '') as String,
      content: (data['content'] ?? '') as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'messageId': messageId,
      'senderName': senderName,
      'content': content,
    };
  }
}

class SupportMessage {
  const SupportMessage({
    required this.id,
    required this.senderId,
    required this.senderRole,
    required this.senderName,
    required this.content,
    required this.messageType,
    this.senderProfileImageUrl,
    this.metadata = const <String, dynamic>{},
    this.replyTo,
    this.visibility = 'case',
    this.readBy = const <String, dynamic>{},
    this.deletedForUsers = const <String, dynamic>{},
    this.editHistory = const <dynamic>[],
    this.createdAt,
    this.updatedAt,
    this.editedAt,
  });

  final String id;
  final String senderId;
  final String senderRole;
  final String senderName;
  final String? senderProfileImageUrl;
  final String content;
  final String messageType;
  final Map<String, dynamic> metadata;
  final SupportReplyReference? replyTo;
  final String visibility;
  final Map<String, dynamic> readBy;
  final Map<String, dynamic> deletedForUsers;
  final List<dynamic> editHistory;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? editedAt;

  bool deletedFor(String uid) => deletedForUsers[uid] == true;
  bool get isSystem => messageType == 'system';
  bool get isAttachment =>
      messageType == 'image' ||
      messageType == 'file' ||
      messageType == 'voice' ||
      messageType == 'video';
  bool get isEdited => editedAt != null || editHistory.isNotEmpty;

  String get fileUrl =>
      (metadata['fileUrl'] ?? metadata['file_url'] ?? '').toString().trim();
  String get fileName =>
      (metadata['fileName'] ?? metadata['file_name'] ?? '').toString().trim();
  String get caption => (metadata['caption'] ?? '').toString().trim();
  int? get fileSize =>
      _intOrNull(metadata['fileSize'] ?? metadata['file_size']);
  int? get durationSeconds =>
      _intOrNull(metadata['durationSeconds'] ?? metadata['duration_seconds']);

  factory SupportMessage.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return SupportMessage.fromMap(doc.id, data);
  }

  factory SupportMessage.fromMap(String id, Map<String, dynamic> data) {
    final replyData = data['replyTo'];
    return SupportMessage(
      id: id,
      senderId: (data['senderId'] ?? '') as String,
      senderRole: (data['senderRole'] ?? '') as String,
      senderName: (data['senderName'] ?? '') as String,
      senderProfileImageUrl: data['senderProfileImageUrl'] as String?,
      content: (data['content'] ?? '') as String,
      messageType: (data['messageType'] ?? 'text') as String,
      metadata: data['metadata'] is Map
          ? Map<String, dynamic>.from(data['metadata'] as Map)
          : const <String, dynamic>{},
      replyTo: replyData is Map
          ? SupportReplyReference.fromMap(Map<String, dynamic>.from(replyData))
          : null,
      visibility: (data['visibility'] ?? 'case') as String,
      readBy: data['readBy'] is Map
          ? Map<String, dynamic>.from(data['readBy'] as Map)
          : const <String, dynamic>{},
      deletedForUsers: data['deletedForUsers'] is Map
          ? Map<String, dynamic>.from(data['deletedForUsers'] as Map)
          : const <String, dynamic>{},
      editHistory: data['editHistory'] is List
          ? List<dynamic>.from(data['editHistory'] as List)
          : const <dynamic>[],
      createdAt: _toDateTime(data['createdAt']),
      updatedAt: _toDateTime(data['updatedAt']),
      editedAt: _toDateTime(data['editedAt']),
    );
  }

  SupportReplyReference toReplyReference({String? senderNameOverride}) {
    return SupportReplyReference(
      messageId: id,
      senderName: senderNameOverride ?? senderName,
      content: content.isEmpty ? messageType : content,
    );
  }

  static DateTime? _toDateTime(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return null;
  }

  static int? _intOrNull(dynamic value) {
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}
