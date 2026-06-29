import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';

/// The customer home: a modern, fintech-style hub that opens with a greeting
/// and live wallet balance, then surfaces every service as clean, grouped list
/// rows that are easy to scan and tap.
class ServicesHubScreen extends StatelessWidget {
  const ServicesHubScreen({super.key, required this.onCustomize});

  /// Opens the "customize navbar" editor.
  final VoidCallback onCustomize;

  static String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final sections = <_HubSection>[
      _HubSection('Ship & send home', [
        _HubItem('Send a barrel', 'Ship a full barrel home',
            Icons.local_shipping_outlined, AppColors.cobalt, '/barrel'),
        _HubItem('Shared barrels', 'Post or join a barrel',
            Icons.group_add_outlined, AppColors.saffron, '/open-barrels'),
        _HubItem('Freight (parcels)', 'By weight · air or sea',
            Icons.inventory_2_outlined, AppColors.sage, '/send-freight'),
      ]),
      _HubSection('Cars', [
        _HubItem('Browse cars', 'Buy a verified car',
            Icons.directions_car_outlined, AppColors.cobalt, '/sell'),
        _HubItem('Park a car', 'Store with a business',
            Icons.local_parking_outlined, AppColors.cobaltMid, '/park'),
        _HubItem('Transport a car', 'Request through a business',
            Icons.car_rental_outlined, AppColors.saffron, '/request-transport'),
      ]),
      _HubSection('Your account', [
        _HubItem('My purchases', 'Orders & receipts',
            Icons.receipt_long_outlined, AppColors.cobalt, '/my-purchases'),
        _HubItem('Track a shipment', 'Follow your shipments',
            Icons.route_outlined, AppColors.cobaltMid, '/tracking'),
        _HubItem('Wallet', 'Balance & refunds',
            Icons.account_balance_wallet_outlined, AppColors.sage, '/wallet'),
      ]),
    ];

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 28),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 16, 4),
              child: _GreetingHeader(auth: auth, onCustomize: onCustomize),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
              child: _BalanceCard(auth: auth),
            ),
            for (final section in sections) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(22, 26, 22, 12),
                child: Text(
                  section.title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                    letterSpacing: 0.1,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _ServicesSection(items: section.items),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _GreetingHeader extends StatelessWidget {
  const _GreetingHeader({required this.auth, required this.onCustomize});

  final AuthProvider auth;
  final VoidCallback onCustomize;

  @override
  Widget build(BuildContext context) {
    final signedIn = auth.isAuthenticated;
    final name = signedIn ? auth.buyerName : 'there';
    final photo = auth.profileImageUrl;
    final initial = (name.isNotEmpty ? name[0] : '?').toUpperCase();

    return Row(
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: AppColors.headerGradient,
            image: photo != null && photo.isNotEmpty
                ? DecorationImage(
                    image: NetworkImage(photo), fit: BoxFit.cover)
                : null,
          ),
          alignment: Alignment.center,
          child: photo != null && photo.isNotEmpty
              ? null
              : Text(
                  initial,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 18,
                  ),
                ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                ServicesHubScreen._greeting(),
                style: const TextStyle(
                  color: AppColors.muted,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.ink,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
        IconButton.filledTonal(
          tooltip: 'Customize navbar',
          onPressed: onCustomize,
          icon: const Icon(Icons.tune, size: 20),
        ),
      ],
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.auth});

  final AuthProvider auth;

  @override
  Widget build(BuildContext context) {
    final user = auth.user;
    if (user == null) {
      return _SignInPromptCard(
        onTap: () => Navigator.pushNamed(context, '/login'),
      );
    }
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('wallets')
          .doc(user.uid)
          .snapshots(),
      builder: (context, snapshot) {
        final data = snapshot.data?.data();
        final currencyCode =
            (data?['currency'] as String?)?.toUpperCase() ?? 'USD';
        final balance = (data?['balance'] as num?)?.toDouble() ??
            (((data?['balanceCents'] as num?)?.toDouble() ?? 0) / 100);
        final currency = NumberFormat.simpleCurrency(name: currencyCode);
        return _BalanceCardBody(
          balanceLabel: currency.format(balance),
        );
      },
    );
  }
}

class _BalanceCardBody extends StatelessWidget {
  const _BalanceCardBody({required this.balanceLabel});

  final String balanceLabel;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: () => Navigator.pushNamed(context, '/wallet'),
        child: Ink(
          decoration: BoxDecoration(
            gradient: AppColors.headerGradient,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: AppColors.cobaltDeep.withValues(alpha: 0.28),
                blurRadius: 22,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 20, 22, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text(
                      'Available balance',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const Spacer(),
                    Icon(
                      Icons.account_balance_wallet_outlined,
                      color: Colors.white.withValues(alpha: 0.9),
                      size: 20,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  balanceLabel,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 32,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _BalanceAction(
                        icon: Icons.add,
                        label: 'Add money',
                        onTap: () => Navigator.pushNamed(context, '/wallet'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _BalanceAction(
                        icon: Icons.receipt_long_outlined,
                        label: 'My orders',
                        onTap: () =>
                            Navigator.pushNamed(context, '/my-purchases'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BalanceAction extends StatelessWidget {
  const _BalanceAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.16),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 11),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 18),
              const SizedBox(width: 7),
              Text(
                label,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SignInPromptCard extends StatelessWidget {
  const _SignInPromptCard({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            gradient: AppColors.headerGradient,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: AppColors.cobaltDeep.withValues(alpha: 0.28),
                blurRadius: 22,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 20, 18, 20),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Sign in to your wallet',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Track orders, balances and refunds.',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.85),
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.arrow_forward_rounded, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HubSection {
  const _HubSection(this.title, this.items);
  final String title;
  final List<_HubItem> items;
}

class _HubItem {
  const _HubItem(this.title, this.subtitle, this.icon, this.color, this.route);
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final String route;
}

/// A rounded white card holding the rows of one section, separated by light
/// dividers. No grid, so there are never empty cells or uneven gaps.
class _ServicesSection extends StatelessWidget {
  const _ServicesSection({required this.items});

  final List<_HubItem> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.rule),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withValues(alpha: 0.04),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0)
              const Divider(
                height: 1,
                thickness: 1,
                indent: 72,
                endIndent: 16,
                color: AppColors.rule,
              ),
            _ServiceRow(item: items[i]),
          ],
        ],
      ),
    );
  }
}

class _ServiceRow extends StatelessWidget {
  const _ServiceRow({required this.item});

  final _HubItem item;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.pushNamed(context, item.route),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: item.color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(item.icon, color: item.color, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    item.title,
                    style: const TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.subtitle,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.muted,
                      height: 1.2,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_right_rounded,
              color: AppColors.muted,
              size: 24,
            ),
          ],
        ),
      ),
    );
  }
}
