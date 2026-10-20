import 'dart:async';

import 'package:plaid_flutter/plaid_flutter.dart';

import 'bank_check.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;
import 'zelle_check.dart';

/// The bank callables (docs/ZELLE_BANK_CHECK.md). Every call goes through the
/// one caller the container and inventory sheets use, so a refusal for a
/// stale device token is retried once with a fresh one, and a widget test
/// answers in place of Firebase.
class ZelleCheckService {
  const ZelleCheckService({this.caller = callContainerCallable});

  final ContainerCallableCaller caller;

  Future<BusinessBankStatus> bankStatus(String businessId) async =>
      BusinessBankStatus.fromCallable(
        await caller('getBusinessBankStatus', businessBankRequest(businessId)),
      );

  /// Null when the server answered without a token.
  Future<BankLinkToken?> createLinkToken(
    String businessId, {
    required String platform,
    String language = '',
  }) async => BankLinkToken.fromCallable(
    await caller(
      'createBankLinkToken',
      createBankLinkTokenRequest(
        businessId,
        platform: platform,
        language: language,
      ),
    ),
  );

  Future<BankConnectResult> connect(
    String businessId, {
    required String publicToken,
    String? accountId,
  }) async => BankConnectResult.fromCallable(
    await caller(
      'connectBusinessBank',
      connectBusinessBankRequest(
        businessId,
        publicToken: publicToken,
        accountId: accountId,
      ),
    ),
  );

  Future<void> setWindow(String businessId, int minutes) async {
    await caller(
      'setBankCheckWindow',
      setBankCheckWindowRequest(businessId, minutes),
    );
  }

  /// The owner's monthly limit of paid refreshes; answers the limit the
  /// server kept (null when it did not say).
  Future<int?> setRefreshLimit(String businessId, int refreshLimit) async =>
      bankRefreshLimitFromAnswer(
        await caller(
          'setBankCheckWindow',
          setBankRefreshLimitRequest(businessId, refreshLimit),
        ),
      );

  Future<void> disconnect(String businessId) async {
    await caller('disconnectBusinessBank', businessBankRequest(businessId));
  }

  /// Null when the answer could not be read. [auto] for the sheet's own
  /// timed re-checks (not counted as a check someone made).
  Future<ZelleCheckResult?> check(
    String businessId,
    ZelleCheckKind kind,
    String id, {
    bool auto = false,
  }) async => ZelleCheckResult.fromCallable(
    await caller(
      'checkZellePayment',
      checkZellePaymentRequest(businessId, kind, id, auto: auto),
    ),
  );

  /// "Check bank": deposits of exactly [amountCents] sent [since]. Null when
  /// the answer could not be read.
  Future<BankCheckAnswer?> checkStandalone(
    String businessId, {
    required int amountCents,
    BankCheckSince since = defaultBankCheckSince,
    bool auto = false,
  }) async => BankCheckAnswer.fromCallable(
    await caller(
      'checkZellePayment',
      standaloneBankCheckRequest(
        businessId,
        amountCents: amountCents,
        since: since,
        auto: auto,
      ),
    ),
  );

  /// "Use for a sale": the payments a deposit can confirm (recent ones, or
  /// those matching [query]). Null when the answer could not be read.
  Future<BankUseRecords?> useRecords(
    String businessId,
    String creditId, {
    String query = '',
  }) async => BankUseRecords.fromCallable(
    await caller(
      'confirmZelleCandidate',
      bankUseRecordsRequest(businessId, creditId, query: query),
    ),
  );

  /// Spends the deposit on the picked payment.
  Future<ZelleCheckResult?> useDeposit(
    String businessId,
    String creditId,
    BankUseRecord record,
  ) async => ZelleCheckResult.fromCallable(
    await caller(
      'confirmZelleCandidate',
      bankUseDepositRequest(businessId, creditId, record.kind, record.id),
    ),
  );

  Future<ZelleCheckResult?> confirmCandidate(
    String businessId,
    ZelleCheckKind kind,
    String id,
    String creditId,
  ) async => ZelleCheckResult.fromCallable(
    await caller(
      'confirmZelleCandidate',
      confirmZelleCandidateRequest(businessId, kind, id, creditId),
    ),
  );
}

// ---------------------------------------------------------------------------
// Plaid Link, behind an interface so the screens are tested with a fake.
// ---------------------------------------------------------------------------

/// How a Link session ended.
class BankLinkOutcome {
  const BankLinkOutcome.success({required this.publicToken, this.accountId})
    : exited = false,
      errorCode = '';

  const BankLinkOutcome.exit({this.errorCode = ''})
    : exited = true,
      publicToken = '',
      accountId = null;

  final bool exited;
  final String publicToken;

  /// The account the owner picked, when Link names exactly one.
  final String? accountId;

  /// Plaid's error code when Link closed on an error ('' when the owner
  /// simply closed it).
  final String errorCode;
}

abstract interface class BankLinkLauncher {
  /// Opens Link with [linkToken] and completes when it closes.
  Future<BankLinkOutcome> open(String linkToken);
}

/// The real Plaid Link (native SDKs through `plaid_flutter`).
class PlaidBankLinkLauncher implements BankLinkLauncher {
  const PlaidBankLinkLauncher();

  @override
  Future<BankLinkOutcome> open(String linkToken) async {
    final done = Completer<BankLinkOutcome>();
    late final StreamSubscription<LinkSuccess> onSuccess;
    late final StreamSubscription<LinkExit> onExit;
    onSuccess = PlaidLink.onSuccess.listen((success) {
      if (done.isCompleted) return;
      final accounts = success.metadata.accounts;
      done.complete(
        BankLinkOutcome.success(
          publicToken: success.publicToken,
          accountId: accounts.length == 1 ? accounts.single.id : null,
        ),
      );
    });
    onExit = PlaidLink.onExit.listen((exit) {
      if (done.isCompleted) return;
      done.complete(BankLinkOutcome.exit(errorCode: exit.error?.code ?? ''));
    });
    try {
      await PlaidLink.create(
        configuration: LinkTokenConfiguration(token: linkToken),
      );
      await PlaidLink.open();
      return await done.future;
    } finally {
      await onSuccess.cancel();
      await onExit.cancel();
    }
  }
}
