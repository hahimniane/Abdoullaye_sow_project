import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/notification_routing.dart';
import '../theme/app_colors.dart';

class CustomerNotification {
  const CustomerNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.data,
    required this.read,
  });

  final String id;
  final String title;
  final String body;
  final Map<String, dynamic> data;
  final bool read;

  factory CustomerNotification.fromDoc(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data();
    return CustomerNotification(
      id: doc.id,
      title: (data['title'] ?? '').toString(),
      body: (data['body'] ?? '').toString(),
      data: data['data'] is Map
          ? Map<String, dynamic>.from(data['data'] as Map)
          : <String, dynamic>{
              if (data['type'] != null) 'type': data['type'],
              if (data['shipmentId'] != null) 'shipmentId': data['shipmentId'],
              if (data['relatedId'] != null) 'relatedId': data['relatedId'],
              if (data['relatedCollection'] != null)
                'relatedCollection': data['relatedCollection'],
              if (data['requestId'] != null) 'requestId': data['requestId'],
              if (data['caseId'] != null) 'caseId': data['caseId'],
              if (data['businessId'] != null) 'businessId': data['businessId'],
              if (data['purchaseId'] != null) 'purchaseId': data['purchaseId'],
              if (data['trackingCode'] != null)
                'trackingCode': data['trackingCode'],
            },
      read: data['read'] == true,
    );
  }
}

/// Customer inbox bell. Opens the matching Orders inner tab / record via
/// [routeForNotificationData], the same contract the web console uses.
class CustomerNotificationBell extends StatelessWidget {
  const CustomerNotificationBell({
    super.key,
    this.iconColor,
    FirebaseFirestore? firestore,
  }) : _firestore = firestore;

  final Color? iconColor;
  final FirebaseFirestore? _firestore;

  @override
  Widget build(BuildContext context) {
    AuthProvider? auth;
    try {
      auth = Provider.of<AuthProvider>(context);
    } on ProviderNotFoundException {
      // Hub widget tests pump Shipping without Firebase-backed AuthProvider.
      auth = null;
    }
    final uid = auth?.user?.uid;
    if (uid == null || uid.isEmpty) return const SizedBox.shrink();
    return _SignedInBell(
      uid: uid,
      iconColor: iconColor,
      firestore: _firestore ?? FirebaseFirestore.instance,
    );
  }
}

class _SignedInBell extends StatelessWidget {
  const _SignedInBell({
    required this.uid,
    required this.firestore,
    this.iconColor,
  });

  final String uid;
  final FirebaseFirestore firestore;
  final Color? iconColor;

  Stream<List<CustomerNotification>> get _stream {
    return firestore
        .collection('users')
        .doc(uid)
        .collection('notifications')
        .orderBy('createdAt', descending: true)
        .limit(30)
        .snapshots()
        .map((snapshot) => snapshot.docs.map(CustomerNotification.fromDoc).toList());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return StreamBuilder<List<CustomerNotification>>(
      stream: _stream,
      builder: (context, snapshot) {
        final items = snapshot.data ?? const <CustomerNotification>[];
        final unread = items.where((item) => !item.read).length;
        return IconButton(
          tooltip: l10n.notifications,
          onPressed: () => _openInbox(context, items),
          icon: Badge(
            isLabelVisible: unread > 0,
            label: Text(unread > 9 ? '9+' : '$unread'),
            child: Icon(
              Icons.notifications_outlined,
              color: iconColor ?? AppColors.ink,
            ),
          ),
        );
      },
    );
  }

  Future<void> _openInbox(
    BuildContext context,
    List<CustomerNotification> items,
  ) {
    final l10n = AppLocalizations.of(context)!;
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.7,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  title: Text(
                    l10n.notifications,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  trailing: unreadOf(items) > 0
                      ? TextButton(
                          onPressed: () {
                            _markAllRead(items);
                            Navigator.pop(sheetContext);
                          },
                          child: Text(l10n.markAllNotificationsRead),
                        )
                      : null,
                ),
                if (items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                    child: Text(
                      l10n.noNotificationsYet,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Theme.of(sheetContext).hintColor),
                    ),
                  )
                else
                  Flexible(
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final item = items[index];
                        return ListTile(
                          leading: Icon(
                            item.read
                                ? Icons.notifications_none_outlined
                                : Icons.notifications_active_outlined,
                            color: item.read
                                ? AppColors.muted
                                : AppColors.cobalt,
                          ),
                          title: Text(
                            item.title.isEmpty
                                ? l10n.notifications
                                : item.title,
                            style: TextStyle(
                              fontWeight: item.read
                                  ? FontWeight.w500
                                  : FontWeight.w800,
                            ),
                          ),
                          subtitle: item.body.isEmpty ? null : Text(item.body),
                          onTap: () {
                            _markRead(item);
                            Navigator.pop(sheetContext);
                            _openRoute(context, item.data);
                          },
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  int unreadOf(List<CustomerNotification> items) =>
      items.where((item) => !item.read).length;

  void _markRead(CustomerNotification item) {
    if (item.read) return;
    firestore
        .collection('users')
        .doc(uid)
        .collection('notifications')
        .doc(item.id)
        .update({'read': true, 'readAt': FieldValue.serverTimestamp()});
  }

  void _markAllRead(List<CustomerNotification> items) {
    for (final item in items) {
      _markRead(item);
    }
  }

  void _openRoute(BuildContext context, Map<String, dynamic> data) {
    final audience = context.read<AuthProvider>().hasBusinessDashboardAccess
        ? NotificationAudience.business
        : NotificationAudience.customer;
    final route = routeForNotificationData(data, audience: audience);
    if (route == null) return;
    Navigator.of(context).pushNamed(route.name, arguments: route.arguments);
  }
}
