import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Someone this customer has shipped to before.
///
/// Written by the server on every barrel/freight send and keyed by the
/// recipient's phone digits, so the same person is one record no matter how
/// many times they are sent to (see functions/saved_recipients.js).
class SavedRecipient {
  const SavedRecipient({
    required this.id,
    required this.name,
    required this.phone,
    this.countryId = '',
    this.countryName = '',
    this.address = '',
    this.whatsappOnly = false,
    this.useCount = 0,
  });

  final String id;
  final String name;
  final String phone;
  final String countryId;
  final String countryName;
  final String address;
  final bool whatsappOnly;
  final int useCount;

  factory SavedRecipient.fromDoc(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return SavedRecipient(
      id: doc.id,
      name: (data['name'] ?? '') as String,
      phone: (data['phone'] ?? '') as String,
      countryId: (data['countryId'] ?? '') as String,
      countryName: (data['countryName'] ?? '') as String,
      address: (data['address'] ?? '') as String,
      whatsappOnly: data['whatsappOnly'] == true,
      useCount: (data['useCount'] as num?)?.toInt() ?? 0,
    );
  }

  /// True when this recipient is a plausible completion for what has been
  /// typed so far. Matching the phone too means a customer who starts with
  /// the number still gets the profile.
  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return name.toLowerCase().contains(q) ||
        phone.replaceAll(RegExp(r'\D'), '').contains(q.replaceAll(
          RegExp(r'\D'),
          '',
        ));
  }
}

/// Reads the recipients the signed-in customer has shipped to.
///
/// Read-only by design: the server owns the writes, so a client can never
/// invent or corrupt a recipient (customers may delete ones they no longer
/// want offered).
class SavedRecipientService {
  SavedRecipientService({FirebaseFirestore? firestore, FirebaseAuth? auth})
    : _firestore = firestore ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  Stream<List<SavedRecipient>> recipients() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return Stream.value(const []);
    return _firestore
        .collection('users')
        .doc(uid)
        .collection('savedRecipients')
        .orderBy('lastUsedAt', descending: true)
        .limit(50)
        .snapshots()
        .map(
          (snapshot) =>
              snapshot.docs.map(SavedRecipient.fromDoc).toList(),
        )
        .handleError((_) => const <SavedRecipient>[]);
  }

  Future<void> forget(String recipientId) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return;
    await _firestore
        .collection('users')
        .doc(uid)
        .collection('savedRecipients')
        .doc(recipientId)
        .delete();
  }
}
