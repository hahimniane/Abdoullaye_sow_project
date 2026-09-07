import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/lot_customers.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';

/// The lot ledger, yard-side.
///
/// Staff standing next to a car record what the lot just did for it, or log a
/// purchase they made for the lot, without opening the web console. The screens
/// mirror `admin_web`'s Lot ledger and call the same authority callables
/// (`createLotActivity`, `createLotExpenseEntry`); the activity catalogue and
/// the expense lines are the business's own, read live from Firestore, never a
/// hard-coded list.
class LotLedgerScreen extends StatefulWidget {
  const LotLedgerScreen({super.key, required this.businessId});

  final String businessId;

  @override
  State<LotLedgerScreen> createState() => _LotLedgerScreenState();
}

class _LotLedgerScreenState extends State<LotLedgerScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        leading: const AppBackButton(),
        title: const Text('Lot ledger'),
        bottom: TabBar(
          controller: _tabs,
          labelColor: AppColors.cobaltDeep,
          indicatorColor: AppColors.cobalt,
          tabs: const [
            Tab(text: 'Record activity'),
            Tab(text: 'Record expense'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _RecordActivityForm(businessId: widget.businessId, db: _db),
          _RecordExpenseForm(businessId: widget.businessId, db: _db),
        ],
      ),
    );
  }
}

String _middayIso(DateTime day) {
  final d = DateFormat('yyyy-MM-dd').format(day);
  return '${d}T12:00:00';
}

int? _dollarsToCents(String raw) {
  final cleaned = raw.replaceAll(RegExp(r'[$,\s]'), '');
  if (cleaned.isEmpty) return null;
  final value = double.tryParse(cleaned);
  if (value == null) return null;
  return (value * 100).round();
}

/// A staff picker backed by the business's users, shared by both forms.
class _StaffDropdown extends StatelessWidget {
  const _StaffDropdown({
    required this.businessId,
    required this.db,
    required this.value,
    required this.onChanged,
    required this.label,
  });

  final String businessId;
  final FirebaseFirestore db;
  final String? value;
  final ValueChanged<String?> onChanged;
  final String label;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: db
          .collection('users')
          .where('businessId', isEqualTo: businessId)
          .snapshots(),
      builder: (context, snapshot) {
        final docs = snapshot.data?.docs ?? [];
        return DropdownButtonFormField<String>(
          initialValue: value,
          isExpanded: true,
          decoration: InputDecoration(labelText: label),
          items: [
            for (final doc in docs)
              DropdownMenuItem(
                value: doc.id,
                child: Text(
                  (doc.data()['fullName'] ??
                          doc.data()['name'] ??
                          doc.data()['email'] ??
                          doc.id)
                      .toString(),
                ),
              ),
          ],
          onChanged: onChanged,
        );
      },
    );
  }
}

class _RecordActivityForm extends StatefulWidget {
  const _RecordActivityForm({required this.businessId, required this.db});

  final String businessId;
  final FirebaseFirestore db;

  @override
  State<_RecordActivityForm> createState() => _RecordActivityFormState();
}

class _RecordActivityFormState extends State<_RecordActivityForm> {
  final _fee = TextEditingController();
  final _vin = TextEditingController();
  final _customer = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _carMake = TextEditingController();
  final _carModel = TextEditingController();
  final _carYear = TextEditingController();
  final _customerFocus = FocusNode();

  List<LotCustomer> _customers = const [];
  LotCustomer? _customerPick;

  String? _typeId;
  bool _typeNeedsAuction = false;
  String _auctionHouse = '';
  DateTime _date = DateTime.now();
  String _method = 'payment_link';
  String _receivedVia = 'cash';
  String? _receivedBy;
  bool _busy = false;

  static const _received = [
    'zelle', 'cash', 'cashapp', 'venmo', 'check', 'card_in_person', 'other',
  ];
  static const _auctions = [
    'ACV', 'IAAI', 'Copart', 'Adesa', 'Manheim', 'Other',
  ];

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  // The lot's customer memory: everyone recorded on an activity or a walk-up,
  // with the cars seen against them, offered back as staff type.
  Future<void> _loadCustomers() async {
    try {
      final snap = await widget.db
          .collection('lotCustomers')
          .where('businessId', isEqualTo: widget.businessId)
          .orderBy('lastSeenAt', descending: true)
          .limit(500)
          .get();
      if (!mounted) return;
      setState(() {
        _customers = [
          for (final d in snap.docs) LotCustomer.fromMap(d.id, d.data()),
        ];
      });
    } catch (_) {
      // No memory yet, or no permission: the form still works by hand.
    }
  }

  void _applyCustomerCar(LotCustomerCar car) {
    setState(() {
      if (car.vin.isNotEmpty) _vin.text = car.vin;
      if (car.make.isNotEmpty) _carMake.text = car.make;
      if (car.model.isNotEmpty) _carModel.text = car.model;
      if (car.year.isNotEmpty) _carYear.text = car.year;
    });
  }

  // Picking a saved customer fills their contact details; their car is filled
  // too when they only have one, otherwise the cars are offered as chips.
  void _pickCustomer(LotCustomer c) {
    setState(() {
      _customerPick = c;
      _customer.text = c.name;
      if (c.phone.isNotEmpty) _phone.text = c.phone;
      if (c.email.isNotEmpty) _email.text = c.email;
    });
    if (c.cars.length == 1) _applyCustomerCar(c.cars.first);
  }

  Future<void> _openDocument(String activityId, bool paid) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final response = await FirebaseFunctions.instance
          .httpsCallable('getLotActivityDocumentUrl')
          .call<Object?>(<String, dynamic>{'activityId': activityId});
      final data = response.data;
      final url = data is Map ? (data['url'] ?? '').toString() : '';
      final uri = url.isNotEmpty ? Uri.tryParse(url) : null;
      if (uri == null || !mounted) {
        if (mounted) showErrorSnackBar(context, l10n.lotDocumentCouldNotBeOpened);
        return;
      }
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        showErrorSnackBar(context, l10n.lotDocumentCouldNotBeOpened);
      }
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.lotDocumentCouldNotBeOpened);
    }
  }

  @override
  void dispose() {
    for (final c in [
      _fee, _vin, _customer, _phone, _email, _carMake, _carModel, _carYear,
    ]) {
      c.dispose();
    }
    _customerFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final feeCents = _dollarsToCents(_fee.text) ?? 0;
    if (_typeId == null) {
      showErrorSnackBar(context, 'Choose what was done.');
      return;
    }
    if (_vin.text.trim().isEmpty) {
      showErrorSnackBar(context, 'Enter the VIN.');
      return;
    }
    if (_customer.text.trim().isEmpty) {
      showErrorSnackBar(context, "Enter the customer's name.");
      return;
    }
    if (_method == 'payment_link' &&
        _phone.text.trim().isEmpty &&
        _email.text.trim().isEmpty) {
      showErrorSnackBar(
        context,
        'A payment link needs a phone number or an email address.',
      );
      return;
    }
    if (_method == 'direct' && (_receivedBy == null || _receivedBy!.isEmpty)) {
      showErrorSnackBar(context, 'Say which staff member took the payment.');
      return;
    }
    setState(() => _busy = true);
    try {
      final result = await FirebaseFunctions.instance
          .httpsCallable('createLotActivity')
          .call<Object?>({
        'businessId': widget.businessId,
        'activityTypeId': _typeId,
        'feeCents': feeCents,
        'activityDate': _middayIso(_date),
        'customerName': _customer.text.trim(),
        'customerPhone': _phone.text.trim(),
        'customerEmail': _email.text.trim(),
        'carMake': _carMake.text.trim(),
        'carModel': _carModel.text.trim(),
        'carYear': _carYear.text.trim(),
        'vinNumber': _vin.text.trim(),
        'auctionHouse': _typeNeedsAuction ? _auctionHouse : '',
        'paymentMethod': _method,
        'receivedVia': _method == 'direct' ? _receivedVia : '',
        'receivedByStaffId': _method == 'direct' ? _receivedBy : '',
      });
      if (!mounted) return;
      final data = result.data;
      final activityId =
          data is Map ? (data['activityId'] ?? '').toString() : '';
      final paid = data is Map && data['paymentStatus'] == 'succeeded';
      final l10n = AppLocalizations.of(context)!;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Activity recorded.'),
          duration: const Duration(seconds: 8),
          action: activityId.isEmpty
              ? null
              : SnackBarAction(
                  label: paid ? l10n.lotOpenReceipt : l10n.lotOpenInvoice,
                  onPressed: () => _openDocument(activityId, paid),
                ),
        ),
      );
      _loadCustomers();
      setState(() {
        _customerPick = null;
        _fee.clear();
        _vin.clear();
        _customer.clear();
        _phone.clear();
        _email.clear();
        _carMake.clear();
        _carModel.clear();
        _carYear.clear();
      });
    } on FirebaseFunctionsException catch (error) {
      if (mounted) {
        showErrorSnackBar(context, error.message ?? 'Could not record it.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: widget.db
                .collection('lotActivityTypes')
                .where('businessId', isEqualTo: widget.businessId)
                .snapshots(),
            builder: (context, snapshot) {
              final docs = (snapshot.data?.docs ?? [])
                  .where((d) => d.data()['active'] != false)
                  .toList()
                ..sort((a, b) => (a.data()['sortOrder'] ?? 0)
                    .compareTo(b.data()['sortOrder'] ?? 0));
              return DropdownButtonFormField<String>(
                initialValue: _typeId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'What was done'),
                items: [
                  for (final doc in docs)
                    DropdownMenuItem(
                      value: doc.id,
                      child: Text(
                        '${doc.data()['label']} — '
                        '\$${((doc.data()['defaultFeeCents'] ?? 0) / 100).toStringAsFixed(2)}',
                      ),
                    ),
                ],
                onChanged: (id) {
                  final doc = docs.where((d) => d.id == id).firstOrNull;
                  setState(() {
                    _typeId = id;
                    _typeNeedsAuction =
                        doc?.data()['needsAuctionHouse'] == true;
                    final rate = doc?.data()['defaultFeeCents'];
                    if (rate is num && rate > 0) {
                      _fee.text = (rate / 100).toStringAsFixed(2);
                    }
                  });
                },
              );
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _fee,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Fee'),
          ),
          const SizedBox(height: 12),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Date'),
            subtitle: Text(DateFormat('EEE, MMM d, y').format(_date)),
            trailing: const Icon(Icons.calendar_today),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _date,
                firstDate: DateTime(2020),
                lastDate: DateTime(2100),
              );
              if (picked != null) setState(() => _date = picked);
            },
          ),
          TextField(
            controller: _vin,
            decoration: const InputDecoration(labelText: 'VIN'),
          ),
          const SizedBox(height: 12),
          RawAutocomplete<LotCustomer>(
            textEditingController: _customer,
            focusNode: _customerFocus,
            optionsBuilder: (value) =>
                _customerPick != null && _customerPick!.name == value.text
                    ? const Iterable<LotCustomer>.empty()
                    : matchLotCustomers(_customers, value.text),
            displayStringForOption: (c) => c.name,
            onSelected: _pickCustomer,
            fieldViewBuilder: (context, controller, focusNode, onSubmit) {
              return TextField(
                controller: controller,
                focusNode: focusNode,
                onChanged: (_) {
                  if (_customerPick != null) {
                    setState(() => _customerPick = null);
                  }
                },
                decoration: const InputDecoration(labelText: 'Customer'),
              );
            },
            optionsViewBuilder: (context, onSelected, options) {
              final l10n = AppLocalizations.of(context)!;
              return Align(
                alignment: Alignment.topLeft,
                child: Material(
                  elevation: 4,
                  borderRadius: BorderRadius.circular(12),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      maxHeight: 260,
                      maxWidth: 420,
                    ),
                    child: ListView(
                      padding: EdgeInsets.zero,
                      shrinkWrap: true,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
                          child: Text(
                            l10n.lotSavedCustomers,
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ),
                        for (final c in options)
                          ListTile(
                            dense: true,
                            title: Text(c.name),
                            subtitle: Text(
                              [
                                c.phone,
                                c.email,
                                if (c.cars.isNotEmpty) c.cars.first.label,
                                if (c.cars.length > 1)
                                  '+${c.cars.length - 1}',
                              ].where((p) => p.isNotEmpty).join(' · '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            onTap: () => onSelected(c),
                          ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
          if (_customerPick != null && _customerPick!.cars.length > 1) ...[
            const SizedBox(height: 8),
            Text(
              AppLocalizations.of(context)!.lotTheirCars,
              style: Theme.of(context).textTheme.labelSmall,
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final car in _customerPick!.cars)
                  ActionChip(
                    label: Text(car.label),
                    onPressed: () => _applyCustomerCar(car),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Phone'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _carMake,
                  decoration: const InputDecoration(labelText: 'Car make'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _carModel,
                  decoration: const InputDecoration(labelText: 'Car model'),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 80,
                child: TextField(
                  controller: _carYear,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Year'),
                ),
              ),
            ],
          ),
          if (_typeNeedsAuction) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _auctionHouse.isEmpty ? null : _auctionHouse,
              decoration: const InputDecoration(labelText: 'Auction house'),
              items: [
                for (final a in _auctions)
                  DropdownMenuItem(value: a, child: Text(a)),
              ],
              onChanged: (v) => setState(() => _auctionHouse = v ?? ''),
            ),
          ],
          const SizedBox(height: 16),
          const Text('How it gets paid',
              style: TextStyle(fontWeight: FontWeight.w700)),
          RadioGroup<String>(
            groupValue: _method,
            onChanged: (v) {
              if (v == null) return;
              setState(() => _method = v);
            },
            child: Column(
              children: [
                const RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  value: 'payment_link',
                  title: Text('Charge through the website'),
                  subtitle: Text(
                    'A payment link goes to the customer and the money lands '
                    'in your account.',
                  ),
                ),
                if (_method == 'payment_link')
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      helperText: 'The link goes by text and email.',
                    ),
                  ),
                const RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  value: 'direct',
                  title: Text('Paid outside the website'),
                  subtitle:
                      Text('Cash, Zelle, a check. Record who took it.'),
                ),
                if (_method == 'direct') ...[
                  DropdownButtonFormField<String>(
                    initialValue: _receivedVia,
                    decoration:
                        const InputDecoration(labelText: 'How it was paid'),
                    items: [
                      for (final m in _received)
                        DropdownMenuItem(value: m, child: Text(m)),
                    ],
                    onChanged: (v) =>
                        setState(() => _receivedVia = v ?? 'cash'),
                  ),
                  const SizedBox(height: 12),
                  _StaffDropdown(
                    businessId: widget.businessId,
                    db: widget.db,
                    value: _receivedBy,
                    label: 'Received by',
                    onChanged: (v) => setState(() => _receivedBy = v),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? 'Saving…' : 'Record activity'),
          ),
        ],
      ),
    );
  }
}

class _RecordExpenseForm extends StatefulWidget {
  const _RecordExpenseForm({required this.businessId, required this.db});

  final String businessId;
  final FirebaseFirestore db;

  @override
  State<_RecordExpenseForm> createState() => _RecordExpenseFormState();
}

class _RecordExpenseFormState extends State<_RecordExpenseForm> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String? _lineId;
  String? _paidBy;
  DateTime _date = DateTime.now();
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final cents = _dollarsToCents(_amount.text);
    if (_lineId == null) {
      showErrorSnackBar(context, 'Choose an expense line.');
      return;
    }
    if (cents == null || cents <= 0) {
      showErrorSnackBar(context, 'Enter what was spent.');
      return;
    }
    if (_paidBy == null || _paidBy!.isEmpty) {
      showErrorSnackBar(context, 'Say who paid for it.');
      return;
    }
    setState(() => _busy = true);
    try {
      await FirebaseFunctions.instance
          .httpsCallable('createLotExpenseEntry')
          .call({
        'businessId': widget.businessId,
        'lineId': _lineId,
        'month': DateFormat('yyyy-MM').format(_date),
        'amountCents': cents,
        'spentAt': _middayIso(_date),
        'paidByStaffId': _paidBy,
        'note': _note.text.trim(),
      });
      if (!mounted) return;
      showSuccessSnackBar(context, 'Purchase added.');
      setState(() {
        _amount.clear();
        _note.clear();
      });
    } on FirebaseFunctionsException catch (error) {
      if (mounted) {
        // The server refuses when a receipt is required and none was
        // attached; a receipt upload from the yard is a later refinement,
        // so the message tells staff to use the console for those.
        showErrorSnackBar(context, error.message ?? 'Could not save it.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: widget.db
                .collection('lotExpenseLines')
                .where('businessId', isEqualTo: widget.businessId)
                .snapshots(),
            builder: (context, snapshot) {
              final docs = (snapshot.data?.docs ?? [])
                  .where((d) =>
                      d.data()['active'] != false &&
                      d.data()['kind'] != 'fixed')
                  .toList();
              return DropdownButtonFormField<String>(
                initialValue: _lineId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Expense line'),
                items: [
                  for (final doc in docs)
                    DropdownMenuItem(
                      value: doc.id,
                      child: Text(doc.data()['label']?.toString() ?? doc.id),
                    ),
                ],
                onChanged: (id) => setState(() => _lineId = id),
              );
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Amount'),
          ),
          const SizedBox(height: 12),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Date'),
            subtitle: Text(DateFormat('EEE, MMM d, y').format(_date)),
            trailing: const Icon(Icons.calendar_today),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _date,
                firstDate: DateTime(2020),
                lastDate: DateTime(2100),
              );
              if (picked != null) setState(() => _date = picked);
            },
          ),
          _StaffDropdown(
            businessId: widget.businessId,
            db: widget.db,
            value: _paidBy,
            label: 'Paid by',
            onChanged: (v) => setState(() => _paidBy = v),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(labelText: 'Note'),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? 'Saving…' : 'Add purchase'),
          ),
        ],
      ),
    );
  }
}
