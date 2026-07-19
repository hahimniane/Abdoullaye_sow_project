import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

import '../models/support_case.dart';
import '../models/support_message.dart';
import '../utils/support_attachment_storage.dart';

enum SupportInboxScope { customer, business, admin }

abstract interface class SupportRepository {
  Stream<List<SupportCase>> watchInbox({
    required SupportInboxScope scope,
    String? businessId,
  });

  Stream<SupportCase?> watchCase(String caseId);

  Stream<List<SupportMessage>> watchMessages(String caseId, String uid);

  Stream<List<Map<String, dynamic>>> watchTimeline(String caseId);

  Stream<List<Map<String, dynamic>>> watchInternalNotes(String caseId);

  Future<String> createOrOpenCase(SupportCaseOpenRequest request);

  Future<String> createBusinessPlatformCase({
    required String businessId,
    required String subject,
    required String message,
    String priority = 'normal',
  });

  Future<void> sendMessage({
    required String caseId,
    required String content,
    SupportReplyReference? replyTo,
  });

  Future<void> editMessage({
    required String caseId,
    required String messageId,
    required String content,
  });

  Future<void> deleteMessageForMe({
    required String caseId,
    required String messageId,
  });

  Future<void> markRead(String caseId);

  Future<void> setTyping(String caseId, bool typing);

  Future<void> escalate({
    required String caseId,
    required String reason,
    String? note,
  });

  Future<void> assign({
    required String caseId,
    String? assignedAdminUid,
    String? assignedBusinessUserId,
  });

  Future<void> requestEvidence({required String caseId, required String note});

  Future<void> resolve({
    required String caseId,
    String outcome = 'resolved',
    String? note,
  });

  Future<void> reopen({required String caseId, String? note});

  Future<void> addInternalNote({required String caseId, required String note});

  Future<void> uploadImageMessage({
    required String caseId,
    required XFile file,
    String caption = '',
  });

  Future<void> uploadAttachmentFile({
    required String caseId,
    required String fileName,
    required List<int> bytes,
    required String mimeType,
    required String messageType,
    int? durationSeconds,
    String caption = '',
  });

  Future<void> uploadPickedAttachment({
    required String caseId,
    required XFile file,
    required String mimeType,
    required String messageType,
    int? durationSeconds,
    String caption = '',
  });

  Future<void> uploadAttachmentMetadata({
    required String caseId,
    required String messageType,
    required String fileUrl,
    required String fileName,
    String mimeType = 'application/octet-stream',
    int? fileSize,
    int? durationSeconds,
    String caption = '',
  });
}

class SupportService implements SupportRepository {
  SupportService({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
    FirebaseStorage? storage,
    FirebaseAuth? auth,
  }) : _firestore = firestore ?? FirebaseFirestore.instance,
       _functions = functions ?? FirebaseFunctions.instance,
       _storage = storage ?? FirebaseStorage.instance,
       _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;
  final FirebaseStorage _storage;
  final FirebaseAuth _auth;

  @override
  Stream<List<SupportCase>> watchInbox({
    required SupportInboxScope scope,
    String? businessId,
  }) {
    Query<Map<String, dynamic>> query = _firestore.collection('supportCases');
    switch (scope) {
      case SupportInboxScope.customer:
        final uid = _auth.currentUser?.uid;
        if (uid == null) return Stream.value(const <SupportCase>[]);
        query = query.where('customerUid', isEqualTo: uid);
      case SupportInboxScope.business:
        if (businessId == null || businessId.isEmpty) {
          return Stream.value(const <SupportCase>[]);
        }
        query = query.where('businessId', isEqualTo: businessId);
      case SupportInboxScope.admin:
        query = query.where('escalationStatus', isEqualTo: 'escalated');
    }
    return query.snapshots().map((snapshot) {
      final cases = snapshot.docs.map(SupportCase.fromFirestore).toList()
        ..sort((a, b) {
          final aTime = a.lastMessageAt ?? a.updatedAt ?? a.createdAt;
          final bTime = b.lastMessageAt ?? b.updatedAt ?? b.createdAt;
          return (bTime ?? DateTime.fromMillisecondsSinceEpoch(0)).compareTo(
            aTime ?? DateTime.fromMillisecondsSinceEpoch(0),
          );
        });
      return cases;
    });
  }

  @override
  Stream<SupportCase?> watchCase(String caseId) {
    return _firestore.collection('supportCases').doc(caseId).snapshots().map((
      doc,
    ) {
      if (!doc.exists) return null;
      return SupportCase.fromFirestore(doc);
    });
  }

  @override
  Stream<List<SupportMessage>> watchMessages(String caseId, String uid) {
    return _firestore
        .collection('supportCases')
        .doc(caseId)
        .collection('messages')
        .orderBy('createdAt', descending: true)
        .limit(120)
        .snapshots()
        .map((snapshot) {
          return snapshot.docs
              .map(SupportMessage.fromFirestore)
              .where((message) => !message.deletedFor(uid))
              .toList();
        });
  }

  @override
  Stream<List<Map<String, dynamic>>> watchTimeline(String caseId) {
    return _firestore
        .collection('supportCases')
        .doc(caseId)
        .collection('timeline')
        .orderBy('createdAt', descending: true)
        .limit(80)
        .snapshots()
        .map((snapshot) {
          return snapshot.docs.map((doc) {
            return {'id': doc.id, ...doc.data()};
          }).toList();
        });
  }

  @override
  Stream<List<Map<String, dynamic>>> watchInternalNotes(String caseId) {
    return _firestore
        .collection('supportCases')
        .doc(caseId)
        .collection('internalNotes')
        .orderBy('createdAt', descending: true)
        .limit(80)
        .snapshots()
        .map((snapshot) {
          return snapshot.docs.map((doc) {
            return {'id': doc.id, ...doc.data()};
          }).toList();
        });
  }

  @override
  Future<String> createOrOpenCase(SupportCaseOpenRequest request) async {
    final result = await _functions
        .httpsCallable('createOrOpenSupportCase')
        .call<Map<String, dynamic>>(request.toJson());
    return (result.data['caseId'] ?? '') as String;
  }

  @override
  Future<String> createBusinessPlatformCase({
    required String businessId,
    required String subject,
    required String message,
    String priority = 'normal',
  }) async {
    final result = await _functions
        .httpsCallable('createBusinessPlatformSupportCase')
        .call<Map<String, dynamic>>({
          'businessId': businessId.trim(),
          'subject': subject.trim(),
          'message': message.trim(),
          'priority': priority,
        });
    return (result.data['caseId'] ?? '') as String;
  }

  @override
  Future<void> sendMessage({
    required String caseId,
    required String content,
    SupportReplyReference? replyTo,
  }) async {
    await _functions.httpsCallable('sendSupportMessage').call({
      'caseId': caseId,
      'content': content,
      'messageType': 'text',
      if (replyTo != null) 'replyTo': replyTo.toJson(),
    });
  }

  @override
  Future<void> editMessage({
    required String caseId,
    required String messageId,
    required String content,
  }) async {
    await _functions.httpsCallable('editSupportMessage').call({
      'caseId': caseId,
      'messageId': messageId,
      'content': content,
    });
  }

  @override
  Future<void> deleteMessageForMe({
    required String caseId,
    required String messageId,
  }) async {
    await _functions.httpsCallable('deleteSupportMessageForMe').call({
      'caseId': caseId,
      'messageId': messageId,
    });
  }

  @override
  Future<void> markRead(String caseId) async {
    await _functions.httpsCallable('markSupportCaseRead').call({
      'caseId': caseId,
    });
  }

  @override
  Future<void> setTyping(String caseId, bool typing) async {
    await _functions.httpsCallable('setSupportTyping').call({
      'caseId': caseId,
      'typing': typing,
    });
  }

  @override
  Future<void> escalate({
    required String caseId,
    required String reason,
    String? note,
  }) async {
    await _functions.httpsCallable('escalateSupportCase').call({
      'caseId': caseId,
      'reason': reason,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
  }

  @override
  Future<void> assign({
    required String caseId,
    String? assignedAdminUid,
    String? assignedBusinessUserId,
  }) async {
    await _functions.httpsCallable('assignSupportCase').call({
      'caseId': caseId,
      'assignedAdminUid': ?assignedAdminUid,
      'assignedBusinessUserId': ?assignedBusinessUserId,
    });
  }

  @override
  Future<void> requestEvidence({
    required String caseId,
    required String note,
  }) async {
    await _functions.httpsCallable('requestSupportEvidence').call({
      'caseId': caseId,
      'note': note,
    });
  }

  @override
  Future<void> resolve({
    required String caseId,
    String outcome = 'resolved',
    String? note,
  }) async {
    await _functions.httpsCallable('resolveSupportCase').call({
      'caseId': caseId,
      'outcome': outcome,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
  }

  @override
  Future<void> reopen({required String caseId, String? note}) async {
    await _functions.httpsCallable('reopenSupportCase').call({
      'caseId': caseId,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
  }

  @override
  Future<void> addInternalNote({
    required String caseId,
    required String note,
  }) async {
    await _functions.httpsCallable('addSupportInternalNote').call({
      'caseId': caseId,
      'note': note,
    });
  }

  @override
  Future<void> uploadImageMessage({
    required String caseId,
    required XFile file,
    String caption = '',
  }) async {
    await uploadAttachmentFile(
      caseId: caseId,
      fileName: file.name,
      bytes: await file.readAsBytes(),
      mimeType: file.mimeType ?? 'image/jpeg',
      messageType: 'image',
      caption: caption,
    );
  }

  @override
  Future<void> uploadAttachmentFile({
    required String caseId,
    required String fileName,
    required List<int> bytes,
    required String mimeType,
    required String messageType,
    int? durationSeconds,
    String caption = '',
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Sign in required.');
    final safeName = _safeAttachmentName(fileName);
    final path =
        'support_cases/$caseId/$uid/${DateTime.now().millisecondsSinceEpoch}-$safeName';
    final ref = _storage.ref(path);
    final metadata = SettableMetadata(contentType: mimeType);
    final uploadBytes = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
    await ref.putData(uploadBytes, metadata);
    await _createAttachmentMessage(
      reference: ref,
      caseId: caseId,
      fileName: fileName,
      filePath: path,
      mimeType: mimeType,
      messageType: messageType,
      fileSize: uploadBytes.length,
      durationSeconds: durationSeconds,
      caption: caption,
    );
  }

  @override
  Future<void> uploadPickedAttachment({
    required String caseId,
    required XFile file,
    required String mimeType,
    required String messageType,
    int? durationSeconds,
    String caption = '',
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Sign in required.');
    final safeName = _safeAttachmentName(file.name);
    final path =
        'support_cases/$caseId/$uid/${DateTime.now().millisecondsSinceEpoch}-$safeName';
    final ref = _storage.ref(path);
    final metadata = SettableMetadata(contentType: mimeType);
    await putSupportXFile(reference: ref, file: file, metadata: metadata);
    await _createAttachmentMessage(
      reference: ref,
      caseId: caseId,
      fileName: file.name,
      filePath: path,
      mimeType: mimeType,
      messageType: messageType,
      fileSize: await file.length(),
      durationSeconds: durationSeconds,
      caption: caption,
    );
  }

  Future<void> _createAttachmentMessage({
    required Reference reference,
    required String caseId,
    required String fileName,
    required String filePath,
    required String mimeType,
    required String messageType,
    required int fileSize,
    required String caption,
    int? durationSeconds,
  }) async {
    final url = await reference.getDownloadURL();
    try {
      await _functions.httpsCallable('uploadSupportAttachmentMetadata').call({
        'caseId': caseId,
        'fileUrl': url,
        'filePath': filePath,
        'fileName': fileName,
        'mimeType': mimeType,
        'fileSize': fileSize,
        'messageType': messageType,
        'durationSeconds': ?durationSeconds,
        if (caption.trim().isNotEmpty) 'caption': caption.trim(),
      });
    } catch (_) {
      try {
        await reference.delete();
      } catch (_) {
        // Preserve the callable failure. Cleanup is best-effort.
      }
      rethrow;
    }
  }

  @override
  Future<void> uploadAttachmentMetadata({
    required String caseId,
    required String messageType,
    required String fileUrl,
    required String fileName,
    String mimeType = 'application/octet-stream',
    int? fileSize,
    int? durationSeconds,
    String caption = '',
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Sign in required.');
    final safeName = _safeAttachmentName(fileName);
    final filePath =
        'support_cases/$caseId/$uid/manual-${DateTime.now().millisecondsSinceEpoch}-$safeName';
    await _functions.httpsCallable('uploadSupportAttachmentMetadata').call({
      'caseId': caseId,
      'fileUrl': fileUrl,
      'filePath': filePath,
      'fileName': fileName,
      'mimeType': mimeType,
      'messageType': messageType,
      'fileSize': ?fileSize,
      'durationSeconds': ?durationSeconds,
      if (caption.trim().isNotEmpty) 'caption': caption.trim(),
    });
  }

  String _safeAttachmentName(String fileName) {
    final safeName = fileName
        .replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-')
        .replaceAll(RegExp(r'-+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    return safeName.isEmpty ? 'attachment' : safeName;
  }
}
