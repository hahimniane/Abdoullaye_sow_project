import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key, this.onBack});

  final VoidCallback? onBack;

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  bool _isRequestingRefund = false;

  Future<void> _requestCardRefund(double balance) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        final currency = NumberFormat.simpleCurrency();
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.returnWalletBalance,
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 10),
              Text(
                l10n.walletReturnMessage(currency.format(balance)),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.lightMuted,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(context, true),
                  icon: const Icon(Icons.credit_card),
                  label: Text(l10n.requestReturnToCard),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: Text(l10n.keepInWallet),
                ),
              ),
            ],
          ),
        );
      },
    );

    if (confirmed != true || !mounted) return;
    setState(() => _isRequestingRefund = true);
    try {
      final response = await FirebaseFunctions.instance
          .httpsCallable('requestWalletCardRefund')
          .call<Map<String, dynamic>>();
      final data = Map<String, dynamic>.from(response.data);
      final amount = (data['amount'] as num?)?.toDouble() ?? balance;
      if (!mounted) return;
      showSuccessSnackBar(
        context,
        l10n.returnToCardRequested(
          NumberFormat.simpleCurrency().format(amount),
        ),
      );
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, error.message ?? error.code);
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.couldNotRequestRefund(error.toString()));
    } finally {
      if (mounted) setState(() => _isRequestingRefund = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: auth.hasBusinessDashboardAccess
            ? _BusinessWalletBlocked(onBack: _back)
            : user == null
            ? _SignedOutWallet(onBack: _back)
            : StreamBuilder<DocumentSnapshot>(
                stream: FirebaseFirestore.instance
                    .collection('wallets')
                    .doc(user.uid)
                    .snapshots(),
                builder: (context, snapshot) {
                  final data = snapshot.data?.data() as Map<String, dynamic>?;
                  final currencyCode =
                      (data?['currency'] as String?)?.toUpperCase() ?? 'USD';
                  final balance =
                      (data?['balance'] as num?)?.toDouble() ??
                      (((data?['balanceCents'] as num?)?.toDouble() ?? 0) /
                          100);
                  final pendingRefund =
                      (data?['pendingRefund'] as num?)?.toDouble() ??
                      (((data?['pendingRefundCents'] as num?)?.toDouble() ??
                              0) /
                          100);

                  return Column(
                    children: [
                      _WalletHeader(onBack: _back),
                      Expanded(
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                          children: [
                            _WalletHeroCard(
                              balance: balance,
                              pendingRefund: pendingRefund,
                              currencyCode: currencyCode,
                              isRequestingRefund: _isRequestingRefund,
                              onReturnToCard: balance > 0
                                  ? () => _requestCardRefund(balance)
                                  : null,
                            ),
                            const SizedBox(height: 16),
                            _WalletInfoBand(balance: balance),
                            const SizedBox(height: 16),
                            _TransactionList(userId: user.uid),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
      ),
    );
  }

  void _back() {
    final onBack = widget.onBack;
    if (onBack != null) {
      onBack();
      return;
    }
    Navigator.maybePop(context);
  }
}

class _BusinessWalletBlocked extends StatelessWidget {
  const _BusinessWalletBlocked({this.onBack});

  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      children: [
        _WalletHeader(onBack: onBack ?? () => Navigator.maybePop(context)),
        Expanded(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                l10n.walletBusinessBlocked,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontWeight: FontWeight.w700,
                  height: 1.35,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _WalletHeader extends StatelessWidget {
  const _WalletHeader({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 12, 20, 8),
      child: Row(
        children: [
          AppBackButton(onPressed: onBack),
          Expanded(
            child: Text(
              l10n.walletTitle,
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
            ),
          ),
          const LanguageToggle(),
        ],
      ),
    );
  }
}

class _WalletHeroCard extends StatelessWidget {
  const _WalletHeroCard({
    required this.balance,
    required this.pendingRefund,
    required this.currencyCode,
    required this.isRequestingRefund,
    required this.onReturnToCard,
  });

  final double balance;
  final double pendingRefund;
  final String currencyCode;
  final bool isRequestingRefund;
  final VoidCallback? onReturnToCard;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency(name: currencyCode);
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: AppColors.cobaltDeep,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: AppColors.cobaltDeep.withValues(alpha: 0.22),
            blurRadius: 24,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.account_balance_wallet_outlined,
                  color: Colors.white,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  currencyCode,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            l10n.availableBalance,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.72),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            currency.format(balance),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 42,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
          if (pendingRefund > 0) ...[
            const SizedBox(height: 10),
            Text(
              l10n.pendingReturnToCard(currency.format(pendingRefund)),
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.82),
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          const SizedBox(height: 22),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: AppColors.cobaltDeep,
                disabledBackgroundColor: Colors.white.withValues(alpha: 0.24),
                disabledForegroundColor: Colors.white70,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: isRequestingRefund ? null : onReturnToCard,
              icon: isRequestingRefund
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.credit_card),
              label: Text(
                isRequestingRefund
                    ? l10n.requestingReturn
                    : l10n.returnMoneyToCard,
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WalletInfoBand extends StatelessWidget {
  const _WalletInfoBand({required this.balance});

  final double balance;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.44),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.cobalt.withValues(alpha: 0.16)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, color: AppColors.cobaltDeep),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              balance > 0
                  ? l10n.walletCreditsInfoWithBalance
                  : l10n.walletCreditsInfoEmpty,
              style: const TextStyle(
                color: AppColors.cobaltDeep,
                fontWeight: FontWeight.w700,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TransactionList extends StatelessWidget {
  const _TransactionList({required this.userId});

  final String userId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('wallets')
          .doc(userId)
          .collection('transactions')
          .orderBy('createdAt', descending: true)
          .limit(30)
          .snapshots(),
      builder: (context, snapshot) {
        final docs = snapshot.data?.docs ?? [];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.activity,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 10),
            if (!snapshot.hasData)
              const Center(child: CircularProgressIndicator())
            else if (docs.isEmpty)
              const _EmptyActivity()
            else
              ...docs.map((doc) {
                final data = doc.data() as Map<String, dynamic>;
                return _TransactionTile(data: data);
              }),
          ],
        );
      },
    );
  }
}

class _TransactionTile extends StatelessWidget {
  const _TransactionTile({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final amount =
        (data['amount'] as num?)?.toDouble() ??
        (((data['amountCents'] as num?)?.toDouble() ?? 0) / 100);
    final type = (data['type'] as String?) ?? 'credit';
    final reason = (data['reason'] as String?) ?? '';
    final status = (data['status'] as String?) ?? '';
    final currency = NumberFormat.simpleCurrency(
      name: (data['currency'] as String?)?.toUpperCase() ?? 'USD',
    );
    final createdAt = (data['createdAt'] as Timestamp?)?.toDate();
    final positive = type != 'debit';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: (positive ? AppColors.sage : AppColors.warn).withValues(
                alpha: 0.12,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              positive ? Icons.add : Icons.arrow_outward,
              color: positive ? AppColors.sage : AppColors.warn,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _reasonLabel(l10n, reason, status),
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 2),
                Text(
                  createdAt == null
                      ? l10n.processing
                      : DateFormat.yMMMd().add_jm().format(createdAt),
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          Text(
            '${positive ? '+' : '-'}${currency.format(amount)}',
            style: TextStyle(
              color: positive ? AppColors.sage : AppColors.warn,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }

  String _reasonLabel(AppLocalizations l10n, String reason, String status) {
    if (reason == 'barrel_destination_refund') return l10n.destinationRefund;
    if (reason == 'card_refund_request') {
      return status == 'pending'
          ? l10n.returnToCardRequestedStatus
          : l10n.returnedToCard;
    }
    return reason.replaceAll('_', ' ');
  }
}

class _EmptyActivity extends StatelessWidget {
  const _EmptyActivity();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.rule),
      ),
      child: Text(
        l10n.noWalletActivityYet,
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: AppColors.muted,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _SignedOutWallet extends StatelessWidget {
  const _SignedOutWallet({this.onBack});

  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      children: [
        _WalletHeader(onBack: onBack ?? () => Navigator.maybePop(context)),
        Expanded(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                l10n.signInToViewWallet,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
