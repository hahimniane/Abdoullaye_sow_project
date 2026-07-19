import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/barrel_pool.dart';
import '../models/business_destination_option.dart';
import '../models/business_service.dart';
import '../services/barrel_pool_service.dart';
import '../services/barrel_pricing_service.dart';
import '../services/business_service.dart';
import '../providers/auth_provider.dart';
import '../utils/action_confirmation.dart';
import '../utils/barrel_pool_actions.dart';
import '../utils/root_navigation.dart';
import '../utils/shared_barrel_error.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';
import '../widgets/support_entry_button.dart';
import '../widgets/marketplace_transaction_disclosure.dart';
import 'phone_verification_screen.dart';

class OpenBarrelsScreen extends StatefulWidget {
  const OpenBarrelsScreen({super.key});

  @override
  State<OpenBarrelsScreen> createState() => _OpenBarrelsScreenState();
}

class _OpenBarrelsScreenState extends State<OpenBarrelsScreen> {
  final _service = BarrelPoolService();
  final _businessService = BusinessService();
  final _currency = NumberFormat.simpleCurrency(name: 'USD');
  final Set<String> _busyPoolIds = {};
  BarrelPickupPricing _pickupPricing = BarrelPickupPricing.defaultPricing;
  bool _pickupPricingLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadPickupPricing();
  }

  String copy(String en, String fr) {
    return Localizations.localeOf(context).languageCode == 'fr' ? fr : en;
  }

  String _depositSummary(BarrelPoolResult result) {
    final parts = <String>[_currency.format(result.depositAmount)];
    if (result.walletAppliedAmount > 0) {
      parts.add(
        copy(
          'wallet applied ${_currency.format(result.walletAppliedAmount)}',
          'portefeuille utilisé ${_currency.format(result.walletAppliedAmount)}',
        ),
      );
    }
    if (result.cardDepositAmount > 0) {
      parts.add(
        copy(
          'card ${_currency.format(result.cardDepositAmount)}',
          'carte ${_currency.format(result.cardDepositAmount)}',
        ),
      );
    }
    return parts.join(' · ');
  }

  Future<void> _loadPickupPricing() async {
    final pricing = await BarrelPricingService().pickupPricing().first;
    if (!mounted) return;
    setState(() {
      _pickupPricing = pricing;
      _pickupPricingLoaded = true;
    });
  }

  Future<bool> _ensureVerifiedPhone() async {
    final auth = context.read<AuthProvider>();
    if (auth.phoneVerified) return true;
    final shouldVerify = await showDialog<bool>(
      context: context,
      useRootNavigator: true,
      builder: (dialogContext) => const PhoneVerificationPromptDialog(),
    );
    if (shouldVerify != true || !mounted) return false;
    final verified = await pushRootNamed<bool>(
      context,
      '/verify-phone',
      arguments: const PhoneVerificationArguments(returnToSharedBarrels: true),
    );
    return mounted &&
        verified == true &&
        context.read<AuthProvider>().phoneVerified;
  }

  Future<void> _handleSharedBarrelError(Object error) async {
    debugPrint('Shared barrel action failed: $error');
    if (isPhoneVerificationRequired(error)) {
      await _ensureVerifiedPhone();
      return;
    }
    if (!mounted) return;
    showErrorSnackBar(
      context,
      AppLocalizations.of(context)!.sharedBarrelActionFailed,
    );
  }

  Future<DateTime?> _pickPickupDateTime(DateTime? current) async {
    final now = DateTime.now();
    final initial = current ?? now.add(const Duration(days: 1));
    final date = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now)
          ? initial
          : now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 90)),
    );
    if (date == null || !mounted) return current;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null) return current;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showCreateSheet,
        icon: const Icon(Icons.add),
        label: Text(copy('Post partial barrel', 'Publier un baril partiel')),
      ),
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF0B3B38), Color(0xFF101827)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
                child: Row(
                  children: [
                    const AppBackButton(onDarkBackground: true),
                    Expanded(
                      child: Text(
                        copy('Share a barrel', 'Partager un baril'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),
              Expanded(
                child: Container(
                  width: double.infinity,
                  decoration: const BoxDecoration(
                    color: Color(0xFFF7FAF9),
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(28),
                    ),
                  ),
                  child: DefaultTabController(
                    length: 2,
                    child: Column(
                      children: [
                        TabBar(
                          labelColor: const Color(0xFF0B3B38),
                          unselectedLabelColor: const Color(0xFF64748B),
                          tabs: [
                            Tab(text: copy('Open pools', 'Barils ouverts')),
                            Tab(text: copy('My pools', 'Mes barils')),
                          ],
                        ),
                        Expanded(
                          child: TabBarView(
                            children: [_buildOpenPools(), _buildMyPools()],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOpenPools() {
    return StreamBuilder<List<BarrelPool>>(
      stream: _service.openPools(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          debugPrint('Open shared barrels failed: ${snapshot.error}');
          return _StateMessage(
            icon: Icons.error_outline,
            title: copy(
              'Could not load open barrels',
              'Impossible de charger les barils ouverts',
            ),
            body: AppLocalizations.of(context)!.sharedBarrelsLoadFailed,
          );
        }
        final pools = snapshot.data ?? const <BarrelPool>[];
        if (pools.isEmpty) {
          return _StateMessage(
            icon: Icons.inventory_2_outlined,
            title: copy(
              'No open shared barrels yet',
              'Aucun baril partagé ouvert pour le moment',
            ),
            body: copy(
              'When a customer or business opens unused shares, they will appear here.',
              'Quand un client ou une entreprise ouvre des parts disponibles, elles apparaîtront ici.',
            ),
          );
        }
        return _PoolList(
          pools: pools,
          currency: _currency,
          copy: copy,
          actionLabel: copy('Request one share', 'Demander une part'),
          actionIcon: Icons.add_circle_outline,
          onAction: _showJoinSheet,
        );
      },
    );
  }

  Widget _buildMyPools() {
    final l10n = AppLocalizations.of(context)!;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      return _StateMessage(
        icon: Icons.lock_outline,
        title: copy('Sign in to see your pools', 'Connectez-vous'),
        body: copy(
          'Your shared barrel posts will appear here after you sign in.',
          'Vos publications de barils partagés apparaîtront ici après connexion.',
        ),
      );
    }
    return StreamBuilder<List<BarrelPool>>(
      stream: _service.myPools(uid),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          debugPrint('Customer shared barrels failed: ${snapshot.error}');
          return _StateMessage(
            icon: Icons.error_outline,
            title: copy(
              'Could not load your pools',
              'Impossible de charger vos barils',
            ),
            body: AppLocalizations.of(context)!.sharedBarrelsLoadFailed,
          );
        }
        final pools = snapshot.data ?? const <BarrelPool>[];
        if (pools.isEmpty) {
          return _StateMessage(
            icon: Icons.inventory_outlined,
            title: copy(
              'No shared barrel pools yet',
              'Aucun baril partagé pour le moment',
            ),
            body: copy(
              'Post a partial barrel or request a share to see it here.',
              'Publiez un baril partiel ou demandez une part pour le voir ici.',
            ),
          );
        }
        return _PoolList(
          pools: pools,
          currency: _currency,
          copy: copy,
          actionIcon: Icons.cancel_outlined,
          actionIconFor: (pool) => switch (barrelPoolPrimaryActionFor(pool)) {
            BarrelPoolPrimaryAction.payBalance => Icons.payments_outlined,
            BarrelPoolPrimaryAction.manageRequests => Icons.group_outlined,
            BarrelPoolPrimaryAction.cancelPool => Icons.cancel_outlined,
            BarrelPoolPrimaryAction.leavePool => Icons.logout_outlined,
          },
          actionLabelFor: (pool) => switch (barrelPoolPrimaryActionFor(pool)) {
            BarrelPoolPrimaryAction.payBalance => copy(
              'Pay balance',
              'Payer le solde',
            ),
            BarrelPoolPrimaryAction.manageRequests =>
              l10n.sharedBarrelManageRequests,
            BarrelPoolPrimaryAction.cancelPool => l10n.sharedBarrelCancelPool,
            BarrelPoolPrimaryAction.leavePool => copy(
              'Leave pool',
              'Quitter le baril',
            ),
          },
          actionEnabled: (pool) =>
              !_busyPoolIds.contains(pool.id) &&
              (pool.balancePaymentStatus == 'balance_due' ||
                  ![
                    'sealed',
                    'cancelled',
                    'expired',
                    'delivered',
                  ].contains(pool.status)),
          actionBusy: (pool) => _busyPoolIds.contains(pool.id),
          onAction: _handlePoolAction,
          showSupport: true,
        );
      },
    );
  }

  Future<void> _handlePoolAction(BarrelPool pool) async {
    final l10n = AppLocalizations.of(context)!;
    final action = barrelPoolPrimaryActionFor(pool);
    if (action == BarrelPoolPrimaryAction.manageRequests) {
      await _showJoinRequests(pool);
      return;
    }
    if (action == BarrelPoolPrimaryAction.payBalance) {
      final acceptance = await confirmMarketplaceTransaction(
        context,
        providerNames: pool.businessName,
        transactionSummary: AppLocalizations.of(
          context,
        )!.marketplaceBalancePaymentSummary,
      );
      if (acceptance == null || !mounted) return;
      try {
        await _service.payBalance(pool, marketplaceAcceptance: acceptance);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(copy('Balance paid.', 'Solde payé.'))),
        );
      } catch (error) {
        debugPrint('Shared barrel balance payment failed: $error');
        if (!mounted) return;
        showErrorSnackBar(context, l10n.couldNotPayBalance);
      }
      return;
    }
    await _leaveOrCancelPool(pool);
  }

  Future<void> _showJoinRequests(BarrelPool pool) async {
    final decidingParticipantIds = <String>{};
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) {
        final l10n = AppLocalizations.of(sheetContext)!;
        return StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            return FractionallySizedBox(
              heightFactor: 0.82,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 18, 12, 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                l10n.sharedBarrelJoinRequests,
                                style: Theme.of(sheetContext)
                                    .textTheme
                                    .titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                l10n.sharedBarrelJoinRequestsHelp,
                                style: const TextStyle(
                                  color: Color(0xFF64748B),
                                ),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: l10n.close,
                          onPressed: () => Navigator.pop(sheetContext),
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: StreamBuilder<List<BarrelPoolParticipant>>(
                      stream: _service.participants(pool.id),
                      builder: (context, snapshot) {
                        if (snapshot.connectionState ==
                            ConnectionState.waiting) {
                          return const Center(
                            child: CircularProgressIndicator(),
                          );
                        }
                        if (snapshot.hasError) {
                          debugPrint(
                            'Shared barrel join requests failed: '
                            '${snapshot.error}',
                          );
                          return _StateMessage(
                            icon: Icons.error_outline,
                            title: l10n.sharedBarrelRequestDecisionFailed,
                            body: l10n.sharedBarrelsLoadFailed,
                          );
                        }
                        final requests = (snapshot.data ?? const [])
                            .where(
                              (participant) =>
                                  participant.joinStatus == 'requested',
                            )
                            .toList();
                        if (requests.isEmpty) {
                          return _StateMessage(
                            icon: Icons.task_alt,
                            title: l10n.sharedBarrelNoPendingRequests,
                            body: pool.trackingCode,
                          );
                        }
                        return ListView.separated(
                          padding: const EdgeInsets.all(18),
                          itemCount: requests.length,
                          separatorBuilder: (_, _) =>
                              const SizedBox(height: 12),
                          itemBuilder: (context, index) {
                            final participant = requests[index];
                            final deciding = decidingParticipantIds.contains(
                              participant.uid,
                            );
                            return Card(
                              elevation: 0,
                              color: const Color(0xFFF8FAFC),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                                side: const BorderSide(
                                  color: Color(0xFFE2E8F0),
                                ),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      participant.senderName,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    const SizedBox(height: 5),
                                    Text(
                                      l10n.sharedBarrelRequestedShareCount(
                                        participant.sharesClaimed,
                                      ),
                                    ),
                                    if (participant
                                        .contentsDescription
                                        .isNotEmpty) ...[
                                      const SizedBox(height: 5),
                                      Text(
                                        participant.contentsDescription,
                                        style: const TextStyle(
                                          color: Color(0xFF475569),
                                        ),
                                      ),
                                    ],
                                    const SizedBox(height: 5),
                                    Text(
                                      l10n.sharedBarrelPaidDeposit(
                                        _currency.format(
                                          participant.depositAmount,
                                        ),
                                      ),
                                      style: const TextStyle(
                                        color: Color(0xFF047857),
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 14),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: OutlinedButton(
                                            onPressed: deciding
                                                ? null
                                                : () => _decideJoinRequest(
                                                    sheetContext,
                                                    setSheetState,
                                                    decidingParticipantIds,
                                                    pool,
                                                    participant,
                                                    accept: false,
                                                  ),
                                            child: Text(l10n.reject),
                                          ),
                                        ),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: FilledButton(
                                            onPressed: deciding
                                                ? null
                                                : () => _decideJoinRequest(
                                                    sheetContext,
                                                    setSheetState,
                                                    decidingParticipantIds,
                                                    pool,
                                                    participant,
                                                    accept: true,
                                                  ),
                                            child: deciding
                                                ? const SizedBox.square(
                                                    dimension: 18,
                                                    child:
                                                        CircularProgressIndicator(
                                                          strokeWidth: 2,
                                                        ),
                                                  )
                                                : Text(l10n.approve),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        );
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 8, 18, 18),
                    child: SizedBox(
                      width: double.infinity,
                      child: TextButton.icon(
                        onPressed: decidingParticipantIds.isNotEmpty
                            ? null
                            : () async {
                                Navigator.pop(sheetContext);
                                await _leaveOrCancelPool(pool);
                              },
                        icon: const Icon(Icons.cancel_outlined),
                        label: Text(l10n.sharedBarrelCancelPool),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _decideJoinRequest(
    BuildContext sheetContext,
    StateSetter setSheetState,
    Set<String> decidingParticipantIds,
    BarrelPool pool,
    BarrelPoolParticipant participant, {
    required bool accept,
  }) async {
    final l10n = AppLocalizations.of(sheetContext)!;
    setSheetState(() => decidingParticipantIds.add(participant.uid));
    try {
      await _service.decideJoin(
        poolId: pool.id,
        participantUid: participant.uid,
        accept: accept,
      );
      if (!sheetContext.mounted) return;
      ScaffoldMessenger.of(sheetContext).showSnackBar(
        SnackBar(
          content: Text(
            accept
                ? l10n.sharedBarrelRequestApproved
                : l10n.sharedBarrelRequestRejected,
          ),
        ),
      );
    } catch (_) {
      if (!sheetContext.mounted) return;
      ScaffoldMessenger.of(sheetContext).showSnackBar(
        SnackBar(content: Text(l10n.sharedBarrelRequestDecisionFailed)),
      );
    } finally {
      if (sheetContext.mounted) {
        setSheetState(() => decidingParticipantIds.remove(participant.uid));
      }
    }
  }

  Future<void> _leaveOrCancelPool(BarrelPool pool) async {
    if (pool.participantRole != 'owner' &&
        (!await _ensureVerifiedPhone() || !mounted)) {
      return;
    }
    if (pool.participantRole == 'owner') {
      final l10n = AppLocalizations.of(context)!;
      final forfeiture = barrelPoolOwnerCancellationForfeiture(pool);
      final confirmed = await confirmMajorAction(
        context,
        title: l10n.sharedBarrelCancelTitle,
        message: l10n.sharedBarrelCancelForfeitureMessage(
          _currency.format(forfeiture),
        ),
        confirmLabel: l10n.sharedBarrelCancelAndForfeit,
        cancelLabel: l10n.sharedBarrelKeepPool,
        icon: Icons.money_off_outlined,
        destructive: true,
      );
      if (!confirmed || !mounted) return;
    }
    if (_busyPoolIds.contains(pool.id)) return;
    setState(() => _busyPoolIds.add(pool.id));
    try {
      if (pool.participantRole == 'owner') {
        await _service.cancelPool(pool.id);
      } else {
        await _service.leavePool(pool.id);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            pool.participantRole == 'owner'
                ? copy('Pool cancelled.', 'Baril partagé annulé.')
                : copy('You left the pool.', 'Vous avez quitté le baril.'),
          ),
        ),
      );
    } catch (error) {
      await _handleSharedBarrelError(error);
    } finally {
      if (mounted) {
        setState(() => _busyPoolIds.remove(pool.id));
      }
    }
  }

  Future<void> _showJoinSheet(BarrelPool pool) async {
    if (FirebaseAuth.instance.currentUser == null) {
      Navigator.pushNamed(context, '/login');
      return;
    }
    if (!await _ensureVerifiedPhone() || !mounted) return;
    final senderController = TextEditingController();
    final receiverController = TextEditingController();
    final phoneController = TextEditingController();
    final contentsController = TextEditingController();
    final pickupAddressController = TextEditingController();
    var contentsAttested = false;
    var prohibitedItemsAcknowledged = false;
    var sharedLiabilityAccepted = false;
    var pickupRequested = false;
    var useWalletBalance = false;
    var pickupBorough = 'Bronx';
    DateTime? pickupDateTime;
    var busy = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            final pickupFee = pickupRequested
                ? _pickupPricing.pickupFeeForBorough(pickupBorough)
                : 0.0;
            Future<void> submit() async {
              if (senderController.text.trim().isEmpty ||
                  receiverController.text.trim().isEmpty ||
                  phoneController.text.trim().isEmpty ||
                  contentsController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      copy(
                        'Fill sender, receiver, phone, and contents.',
                        'Renseignez expéditeur, destinataire, téléphone et contenu.',
                      ),
                    ),
                  ),
                );
                return;
              }
              if (pickupRequested) {
                final pickupDate = pickupDateTime;
                if (pickupAddressController.text.trim().isEmpty ||
                    pickupDate == null ||
                    !pickupDate.isAfter(DateTime.now())) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        copy(
                          'Enter a pickup address and future pickup time.',
                          'Indiquez une adresse et une heure de collecte future.',
                        ),
                      ),
                    ),
                  );
                  return;
                }
                if (!_pickupPricingLoaded || pickupFee <= 0) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        copy(
                          'Pickup price is not available yet.',
                          'Le prix de collecte n’est pas encore disponible.',
                        ),
                      ),
                    ),
                  );
                  return;
                }
              }
              if (!contentsAttested ||
                  !prohibitedItemsAcknowledged ||
                  !sharedLiabilityAccepted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      copy(
                        'Confirm the shared-barrel acknowledgements.',
                        'Confirmez les engagements du baril partagé.',
                      ),
                    ),
                  ),
                );
                return;
              }
              final marketplaceAcceptance = await confirmMarketplaceTransaction(
                context,
                providerNames: pool.businessName,
                transactionSummary: AppLocalizations.of(
                  context,
                )!.hubSharedBarrels,
              );
              if (marketplaceAcceptance == null || !context.mounted) return;
              setSheetState(() => busy = true);
              try {
                final result = await _service.requestJoin(
                  poolId: pool.id,
                  destinationCountryId: pool.destinationCountryId,
                  senderName: senderController.text.trim(),
                  receiverName: receiverController.text.trim(),
                  receiverPhone: phoneController.text.trim(),
                  contentsDescription: contentsController.text.trim(),
                  contentsAttested: contentsAttested,
                  prohibitedItemsAcknowledged: prohibitedItemsAcknowledged,
                  sharedLiabilityAccepted: sharedLiabilityAccepted,
                  pickupRequested: pickupRequested,
                  useWalletBalance: useWalletBalance,
                  pickupAddress: pickupRequested
                      ? pickupAddressController.text.trim()
                      : _pickupPricing.officeAddress,
                  pickupBorough: pickupRequested
                      ? pickupBorough
                      : 'Office drop-off',
                  pickupDateTime: pickupRequested ? pickupDateTime : null,
                  marketplaceAcceptance: marketplaceAcceptance,
                );
                if (!context.mounted || !mounted) return;
                Navigator.pop(context);
                ScaffoldMessenger.of(this.context).showSnackBar(
                  SnackBar(
                    content: Text(
                      copy(
                            'Join request sent. Deposit: ',
                            'Demande envoyée. Acompte : ',
                          ) +
                          _depositSummary(result),
                    ),
                  ),
                );
              } catch (error) {
                if (!context.mounted || !mounted) return;
                await _handleSharedBarrelError(error);
              } finally {
                if (mounted) setSheetState(() => busy = false);
              }
            }

            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
                top: 8,
              ),
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: 14,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          copy('Request a share', 'Demander une part'),
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          copy(
                            'Reserve space in this open barrel.',
                            'Réservez de l’espace dans ce baril ouvert.',
                          ),
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: Theme.of(context).hintColor,
                                height: 1.3,
                              ),
                        ),
                      ],
                    ),
                    TextField(
                      controller: senderController,
                      decoration: InputDecoration(
                        labelText: copy('Sender name', 'Nom de l’expéditeur'),
                      ),
                    ),
                    TextField(
                      controller: receiverController,
                      decoration: InputDecoration(
                        labelText: copy('Receiver name', 'Nom du destinataire'),
                      ),
                    ),
                    TextField(
                      controller: phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: InputDecoration(
                        labelText: copy(
                          'Receiver phone',
                          'Téléphone du destinataire',
                        ),
                      ),
                    ),
                    _PickupSection(
                      copy: copy,
                      currency: _currency,
                      pickupRequested: pickupRequested,
                      pickupAddressController: pickupAddressController,
                      pickupBorough: pickupBorough,
                      pickupDateTime: pickupDateTime,
                      pickupFee: pickupFee,
                      officeAddress: _pickupPricing.officeAddress,
                      onPickupRequestedChanged: busy
                          ? null
                          : (value) =>
                                setSheetState(() => pickupRequested = value),
                      onBoroughChanged: busy
                          ? null
                          : (value) {
                              if (value != null) {
                                setSheetState(() => pickupBorough = value);
                              }
                            },
                      onPickDateTime: busy
                          ? null
                          : () async {
                              final value = await _pickPickupDateTime(
                                pickupDateTime,
                              );
                              if (value != null) {
                                setSheetState(() => pickupDateTime = value);
                              }
                            },
                    ),
                    TextField(
                      controller: contentsController,
                      maxLines: 2,
                      decoration: InputDecoration(
                        labelText: copy(
                          'What are you sending?',
                          'Qu’envoyez-vous ?',
                        ),
                      ),
                    ),
                    _AttestationChecks(
                      copy: copy,
                      contentsAttested: contentsAttested,
                      prohibitedItemsAcknowledged: prohibitedItemsAcknowledged,
                      sharedLiabilityAccepted: sharedLiabilityAccepted,
                      onContentsChanged: busy
                          ? null
                          : (value) => setSheetState(
                              () => contentsAttested = value ?? false,
                            ),
                      onProhibitedChanged: busy
                          ? null
                          : (value) => setSheetState(
                              () =>
                                  prohibitedItemsAcknowledged = value ?? false,
                            ),
                      onLiabilityChanged: busy
                          ? null
                          : (value) => setSheetState(
                              () => sharedLiabilityAccepted = value ?? false,
                            ),
                    ),
                    SwitchListTile(
                      value: useWalletBalance,
                      onChanged: busy
                          ? null
                          : (value) =>
                                setSheetState(() => useWalletBalance = value),
                      title: Text(
                        copy(
                          'Use wallet balance for deposit',
                          'Utiliser le solde du portefeuille pour l’acompte',
                        ),
                      ),
                      subtitle: Text(
                        copy(
                          'Any available wallet credit will reduce the card amount.',
                          'Le crédit disponible réduira le montant à payer par carte.',
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: busy ? null : submit,
                      icon: busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check_circle_outline),
                      label: Text(copy('Send request', 'Envoyer la demande')),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showCreateSheet() async {
    if (FirebaseAuth.instance.currentUser == null) {
      Navigator.pushNamed(context, '/login');
      return;
    }
    if (!await _ensureVerifiedPhone() || !mounted) return;

    List<BusinessDestinationOption> options;
    try {
      final all = await _businessService
          .activeDestinationOptions()
          .first
          .timeout(const Duration(seconds: 15));
      options = all
          .where(
            (option) => option.isAvailableFor(BusinessServiceKey.sharedBarrels),
          )
          .toList();
    } on TimeoutException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            copy(
              'Could not load destinations. Check your connection and try again.',
              'Impossible de charger les destinations. Vérifiez votre connexion et réessayez.',
            ),
          ),
        ),
      );
      return;
    } catch (error) {
      debugPrint('Shared barrel form options failed: $error');
      if (!mounted) return;
      showErrorSnackBar(
        context,
        AppLocalizations.of(context)!.sharedBarrelFormLoadFailed,
      );
      return;
    }
    if (!mounted) return;
    if (options.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            copy(
              'No business is accepting shared barrels yet.',
              'Aucune entreprise n’accepte encore les barils partagés.',
            ),
          ),
        ),
      );
      return;
    }

    final senderController = TextEditingController();
    final receiverController = TextEditingController();
    final phoneController = TextEditingController();
    final contentsController = TextEditingController();
    final pickupAddressController = TextEditingController();
    BusinessDestinationOption selected = options.first;
    var totalShares = 2;
    var sharesClaimed = 1;
    var contentsAttested = false;
    var prohibitedItemsAcknowledged = false;
    var sharedLiabilityAccepted = false;
    var pickupRequested = false;
    var useWalletBalance = false;
    var pickupBorough = 'Bronx';
    DateTime? pickupDateTime;
    var busy = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            final pickupFee = pickupRequested
                ? _pickupPricing.pickupFeeForBorough(pickupBorough)
                : 0.0;
            Future<void> submit() async {
              if (senderController.text.trim().isEmpty ||
                  receiverController.text.trim().isEmpty ||
                  phoneController.text.trim().isEmpty ||
                  contentsController.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      copy(
                        'Fill sender, receiver, phone, and contents.',
                        'Renseignez expéditeur, destinataire, téléphone et contenu.',
                      ),
                    ),
                  ),
                );
                return;
              }
              if (pickupRequested) {
                final pickupDate = pickupDateTime;
                if (pickupAddressController.text.trim().isEmpty ||
                    pickupDate == null ||
                    !pickupDate.isAfter(DateTime.now())) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        copy(
                          'Enter a pickup address and future pickup time.',
                          'Indiquez une adresse et une heure de collecte future.',
                        ),
                      ),
                    ),
                  );
                  return;
                }
                if (!_pickupPricingLoaded || pickupFee <= 0) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        copy(
                          'Pickup price is not available yet.',
                          'Le prix de collecte n’est pas encore disponible.',
                        ),
                      ),
                    ),
                  );
                  return;
                }
              }
              if (!contentsAttested ||
                  !prohibitedItemsAcknowledged ||
                  !sharedLiabilityAccepted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      copy(
                        'Confirm the shared-barrel acknowledgements.',
                        'Confirmez les engagements du baril partagé.',
                      ),
                    ),
                  ),
                );
                return;
              }
              final marketplaceAcceptance = await confirmMarketplaceTransaction(
                context,
                providerNames: selected.businessName,
                transactionSummary: AppLocalizations.of(
                  context,
                )!.hubSharedBarrels,
              );
              if (marketplaceAcceptance == null || !context.mounted) return;
              setSheetState(() => busy = true);
              try {
                final result = await _service.createPool(
                  businessId: selected.businessId,
                  destinationCountryId: selected.country.id,
                  senderName: senderController.text.trim(),
                  receiverName: receiverController.text.trim(),
                  receiverPhone: phoneController.text.trim(),
                  contentsDescription: contentsController.text.trim(),
                  contentsAttested: contentsAttested,
                  prohibitedItemsAcknowledged: prohibitedItemsAcknowledged,
                  sharedLiabilityAccepted: sharedLiabilityAccepted,
                  pickupRequested: pickupRequested,
                  useWalletBalance: useWalletBalance,
                  pickupAddress: pickupRequested
                      ? pickupAddressController.text.trim()
                      : _pickupPricing.officeAddress,
                  pickupBorough: pickupRequested
                      ? pickupBorough
                      : 'Office drop-off',
                  pickupDateTime: pickupRequested ? pickupDateTime : null,
                  totalShares: totalShares,
                  sharesClaimed: sharesClaimed,
                  marketplaceAcceptance: marketplaceAcceptance,
                );
                if (!context.mounted || !mounted) return;
                Navigator.pop(context);
                ScaffoldMessenger.of(this.context).showSnackBar(
                  SnackBar(
                    content: Text(
                      copy(
                            'Shared barrel posted. Deposit: ',
                            'Baril partagé publié. Acompte : ',
                          ) +
                          _depositSummary(result),
                    ),
                  ),
                );
              } catch (error) {
                if (!context.mounted || !mounted) return;
                await _handleSharedBarrelError(error);
              } finally {
                if (mounted) setSheetState(() => busy = false);
              }
            }

            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                bottom: MediaQuery.of(context).viewInsets.bottom + 20,
                top: 8,
              ),
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: 14,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          copy(
                            'Post a partial barrel',
                            'Publier un baril partiel',
                          ),
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          copy(
                            'Share the open space so others can join and fill the barrel.',
                            'Partagez l’espace libre pour que d’autres complètent le baril.',
                          ),
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: Theme.of(context).hintColor,
                                height: 1.3,
                              ),
                        ),
                      ],
                    ),
                    DropdownButtonFormField<BusinessDestinationOption>(
                      initialValue: selected,
                      items: options
                          .map(
                            (
                              option,
                            ) => DropdownMenuItem<BusinessDestinationOption>(
                              value: option,
                              child: Text(
                                '${option.businessName} · ${option.country.name}',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: busy
                          ? null
                          : (value) {
                              if (value != null) {
                                setSheetState(() => selected = value);
                              }
                            },
                      decoration: InputDecoration(
                        labelText: copy(
                          'Business and destination',
                          'Entreprise et destination',
                        ),
                      ),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<int>(
                            initialValue: totalShares,
                            items: [2, 3, 4]
                                .map(
                                  (value) => DropdownMenuItem<int>(
                                    value: value,
                                    child: Text('$value'),
                                  ),
                                )
                                .toList(),
                            onChanged: busy
                                ? null
                                : (value) {
                                    if (value != null) {
                                      setSheetState(() {
                                        totalShares = value;
                                        sharesClaimed = sharesClaimed.clamp(
                                          1,
                                          totalShares - 1,
                                        );
                                      });
                                    }
                                  },
                            decoration: InputDecoration(
                              labelText: copy('Total shares', 'Parts totales'),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: DropdownButtonFormField<int>(
                            initialValue: sharesClaimed,
                            items:
                                List<int>.generate(
                                      totalShares - 1,
                                      (index) => index + 1,
                                    )
                                    .map(
                                      (value) => DropdownMenuItem<int>(
                                        value: value,
                                        child: Text('$value'),
                                      ),
                                    )
                                    .toList(),
                            onChanged: busy
                                ? null
                                : (value) {
                                    if (value != null) {
                                      setSheetState(
                                        () => sharesClaimed = value,
                                      );
                                    }
                                  },
                            decoration: InputDecoration(
                              labelText: copy('Your shares', 'Vos parts'),
                            ),
                          ),
                        ),
                      ],
                    ),
                    TextField(
                      controller: senderController,
                      decoration: InputDecoration(
                        labelText: copy('Sender name', 'Nom de l’expéditeur'),
                      ),
                    ),
                    TextField(
                      controller: receiverController,
                      decoration: InputDecoration(
                        labelText: copy('Receiver name', 'Nom du destinataire'),
                      ),
                    ),
                    TextField(
                      controller: phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: InputDecoration(
                        labelText: copy(
                          'Receiver phone',
                          'Téléphone du destinataire',
                        ),
                      ),
                    ),
                    _PickupSection(
                      copy: copy,
                      currency: _currency,
                      pickupRequested: pickupRequested,
                      pickupAddressController: pickupAddressController,
                      pickupBorough: pickupBorough,
                      pickupDateTime: pickupDateTime,
                      pickupFee: pickupFee,
                      officeAddress: _pickupPricing.officeAddress,
                      onPickupRequestedChanged: busy
                          ? null
                          : (value) =>
                                setSheetState(() => pickupRequested = value),
                      onBoroughChanged: busy
                          ? null
                          : (value) {
                              if (value != null) {
                                setSheetState(() => pickupBorough = value);
                              }
                            },
                      onPickDateTime: busy
                          ? null
                          : () async {
                              final value = await _pickPickupDateTime(
                                pickupDateTime,
                              );
                              if (value != null) {
                                setSheetState(() => pickupDateTime = value);
                              }
                            },
                    ),
                    TextField(
                      controller: contentsController,
                      maxLines: 2,
                      decoration: InputDecoration(
                        labelText: copy(
                          'What are you sending?',
                          'Qu’envoyez-vous ?',
                        ),
                      ),
                    ),
                    _AttestationChecks(
                      copy: copy,
                      contentsAttested: contentsAttested,
                      prohibitedItemsAcknowledged: prohibitedItemsAcknowledged,
                      sharedLiabilityAccepted: sharedLiabilityAccepted,
                      onContentsChanged: busy
                          ? null
                          : (value) => setSheetState(
                              () => contentsAttested = value ?? false,
                            ),
                      onProhibitedChanged: busy
                          ? null
                          : (value) => setSheetState(
                              () =>
                                  prohibitedItemsAcknowledged = value ?? false,
                            ),
                      onLiabilityChanged: busy
                          ? null
                          : (value) => setSheetState(
                              () => sharedLiabilityAccepted = value ?? false,
                            ),
                    ),
                    SwitchListTile(
                      value: useWalletBalance,
                      onChanged: busy
                          ? null
                          : (value) =>
                                setSheetState(() => useWalletBalance = value),
                      title: Text(
                        copy(
                          'Use wallet balance for deposit',
                          'Utiliser le solde du portefeuille pour l’acompte',
                        ),
                      ),
                      subtitle: Text(
                        copy(
                          'Any available wallet credit will reduce the card amount.',
                          'Le crédit disponible réduira le montant à payer par carte.',
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: busy ? null : submit,
                      icon: busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.inventory_2_outlined),
                      label: Text(copy('Post barrel', 'Publier le baril')),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _PickupSection extends StatelessWidget {
  const _PickupSection({
    required this.copy,
    required this.currency,
    required this.pickupRequested,
    required this.pickupAddressController,
    required this.pickupBorough,
    required this.pickupDateTime,
    required this.pickupFee,
    required this.officeAddress,
    required this.onPickupRequestedChanged,
    required this.onBoroughChanged,
    required this.onPickDateTime,
  });

  static const _boroughs = [
    'Bronx',
    'Manhattan',
    'Queens',
    'Brooklyn',
    'Staten Island',
  ];

  final String Function(String en, String fr) copy;
  final NumberFormat currency;
  final bool pickupRequested;
  final TextEditingController pickupAddressController;
  final String pickupBorough;
  final DateTime? pickupDateTime;
  final double pickupFee;
  final String officeAddress;
  final ValueChanged<bool>? onPickupRequestedChanged;
  final ValueChanged<String?>? onBoroughChanged;
  final VoidCallback? onPickDateTime;

  @override
  Widget build(BuildContext context) {
    final pickupDateLabel = pickupDateTime == null
        ? copy('Choose pickup time', 'Choisir l’heure de collecte')
        : DateFormat.yMMMd().add_jm().format(pickupDateTime!);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: pickupRequested,
                onChanged: onPickupRequestedChanged,
                title: Text(
                  copy('Request pickup', 'Demander une collecte'),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  pickupRequested
                      ? copy('Pickup fee: ', 'Frais de collecte : ') +
                            currency.format(pickupFee)
                      : copy('Drop off at ', 'Dépôt à ') + officeAddress,
                ),
              ),
              if (pickupRequested) ...[
                const SizedBox(height: 10),
                TextField(
                  controller: pickupAddressController,
                  decoration: InputDecoration(
                    labelText: copy('Pickup address', 'Adresse de collecte'),
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: pickupBorough,
                  items: _boroughs
                      .map(
                        (borough) => DropdownMenuItem<String>(
                          value: borough,
                          child: Text(borough),
                        ),
                      )
                      .toList(),
                  onChanged: onBoroughChanged,
                  decoration: InputDecoration(
                    labelText: copy('Pickup borough', 'Arrondissement'),
                  ),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: onPickDateTime,
                  icon: const Icon(Icons.event_available_outlined),
                  label: Text(pickupDateLabel),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _AttestationChecks extends StatelessWidget {
  const _AttestationChecks({
    required this.copy,
    required this.contentsAttested,
    required this.prohibitedItemsAcknowledged,
    required this.sharedLiabilityAccepted,
    required this.onContentsChanged,
    required this.onProhibitedChanged,
    required this.onLiabilityChanged,
  });

  final String Function(String en, String fr) copy;
  final bool contentsAttested;
  final bool prohibitedItemsAcknowledged;
  final bool sharedLiabilityAccepted;
  final ValueChanged<bool?>? onContentsChanged;
  final ValueChanged<bool?>? onProhibitedChanged;
  final ValueChanged<bool?>? onLiabilityChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        children: [
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: contentsAttested,
            onChanged: onContentsChanged,
            title: Text(
              copy(
                'I confirm the contents and estimated weight are accurate.',
                'Je confirme que le contenu et le poids estimé sont exacts.',
              ),
            ),
          ),
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: prohibitedItemsAcknowledged,
            onChanged: onProhibitedChanged,
            title: Text(
              copy(
                'I confirm there are no prohibited or unsafe items.',
                'Je confirme qu’il n’y a aucun article interdit ou dangereux.',
              ),
            ),
          ),
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: sharedLiabilityAccepted,
            onChanged: onLiabilityChanged,
            title: Text(
              copy(
                'I understand one bad item can delay the shared barrel.',
                'Je comprends qu’un mauvais article peut retarder le baril partagé.',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PoolList extends StatelessWidget {
  const _PoolList({
    required this.pools,
    required this.currency,
    required this.copy,
    required this.actionIcon,
    required this.onAction,
    this.actionLabel,
    this.actionLabelFor,
    this.actionIconFor,
    this.actionEnabled,
    this.actionBusy,
    this.showSupport = false,
  });

  final List<BarrelPool> pools;
  final NumberFormat currency;
  final String Function(String en, String fr) copy;
  final String? actionLabel;
  final String Function(BarrelPool pool)? actionLabelFor;
  final IconData actionIcon;
  final IconData Function(BarrelPool pool)? actionIconFor;
  final Future<void> Function(BarrelPool pool) onAction;
  final bool Function(BarrelPool pool)? actionEnabled;
  final bool Function(BarrelPool pool)? actionBusy;
  final bool showSupport;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 28),
      itemBuilder: (context, index) {
        final pool = pools[index];
        return _PoolCard(
          pool: pool,
          price: currency.format(pool.pricePerShare),
          deposit: currency.format(pool.depositPerShare),
          deadline: pool.joinDeadline == null
              ? ''
              : DateFormat.yMMMd().format(pool.joinDeadline!),
          actionLabel: actionLabelFor?.call(pool) ?? actionLabel ?? '',
          actionIcon: actionIconFor?.call(pool) ?? actionIcon,
          actionEnabled: actionEnabled?.call(pool) ?? true,
          actionBusy: actionBusy?.call(pool) ?? false,
          onAction: () => onAction(pool),
          copy: copy,
          showSupport: showSupport,
        );
      },
      separatorBuilder: (_, _) => const SizedBox(height: 14),
      itemCount: pools.length,
    );
  }
}

class _PoolCard extends StatelessWidget {
  const _PoolCard({
    required this.pool,
    required this.price,
    required this.deposit,
    required this.deadline,
    required this.actionLabel,
    required this.actionIcon,
    required this.actionEnabled,
    required this.actionBusy,
    required this.onAction,
    required this.copy,
    required this.showSupport,
  });

  final BarrelPool pool;
  final String price;
  final String deposit;
  final String deadline;
  final String actionLabel;
  final IconData actionIcon;
  final bool actionEnabled;
  final bool actionBusy;
  final VoidCallback onAction;
  final String Function(String en, String fr) copy;
  final bool showSupport;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const CircleAvatar(
                  backgroundColor: Color(0xFFE6FFFA),
                  child: Icon(
                    Icons.inventory_2_outlined,
                    color: Color(0xFF0D9488),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        pool.destinationCountryName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                      Text(
                        pool.businessName,
                        style: const TextStyle(color: Color(0xFF64748B)),
                      ),
                    ],
                  ),
                ),
                Chip(label: Text('${pool.openShares}/${pool.totalShares}')),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _InfoChip(label: copy('Per share', 'Par part'), value: price),
                _InfoChip(label: copy('Deposit', 'Acompte'), value: deposit),
                _InfoChip(
                  label: copy('Mode', 'Mode'),
                  value: pool.shipMode.toUpperCase(),
                ),
                if (deadline.isNotEmpty)
                  _InfoChip(label: copy('Deadline', 'Limite'), value: deadline),
              ],
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: actionEnabled ? onAction : null,
                icon: actionBusy
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(actionIcon),
                label: Text(actionLabel),
              ),
            ),
            if (showSupport) ...[
              const SizedBox(height: 10),
              SupportEntryButton(
                relatedCollection: 'barrelPools',
                relatedId: pool.id,
                subject: l10n.supportSharedBarrelCaseSubject,
                relatedLabel: [
                  pool.destinationCountryName,
                  pool.businessName,
                  if (pool.trackingCode.isNotEmpty) pool.trackingCode,
                ].where((value) => value.isNotEmpty).join(' · '),
                compact: true,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        '$label: $value',
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _StateMessage extends StatelessWidget {
  const _StateMessage({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 42, color: const Color(0xFF0D9488)),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF64748B)),
            ),
          ],
        ),
      ),
    );
  }
}
