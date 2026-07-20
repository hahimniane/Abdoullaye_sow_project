import 'package:flutter/material.dart';

import '../data/calling_code_catalog.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/phone_number_validator.dart';

class CountryPhoneField extends StatefulWidget {
  const CountryPhoneField({
    super.key,
    required this.controller,
    required this.labelText,
    this.fieldKey,
    this.hintText,
    this.helperText,
    this.errorText,
    this.enabled = true,
    this.validator,
    this.onChanged,
    this.decoration,
    this.textInputAction,
    this.autofillHints = const [AutofillHints.telephoneNumber],
    this.initialCountryCode = 'US',
    this.showClearButton = false,
  });

  final TextEditingController controller;
  final Key? fieldKey;
  final String labelText;
  final String? hintText;
  final String? helperText;
  final String? errorText;
  final bool enabled;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onChanged;
  final InputDecoration? decoration;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final String initialCountryCode;
  final bool showClearButton;

  @override
  State<CountryPhoneField> createState() => _CountryPhoneFieldState();
}

class _CountryPhoneFieldState extends State<CountryPhoneField> {
  final _visibleController = TextEditingController();
  late PhoneCountryOption _selected;
  bool _syncing = false;

  @override
  void initState() {
    super.initState();
    _selected =
        CallingCodeCatalog.optionForPhoneNumber(
          widget.controller.text,
          fallbackCountryCode: widget.initialCountryCode,
        ) ??
        CallingCodeCatalog.options.first;
    widget.controller.addListener(_syncVisibleFromExternal);
    _syncVisibleFromExternal(writeInternationalValue: true);
  }

  @override
  void didUpdateWidget(CountryPhoneField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_syncVisibleFromExternal);
      widget.controller.addListener(_syncVisibleFromExternal);
      _syncVisibleFromExternal(writeInternationalValue: true);
      return;
    }

    if (oldWidget.initialCountryCode != widget.initialCountryCode &&
        widget.controller.text.trim().isEmpty) {
      _selected =
          CallingCodeCatalog.optionForCountryCode(widget.initialCountryCode) ??
          _selected;
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncVisibleFromExternal);
    _visibleController.dispose();
    super.dispose();
  }

  void _setVisibleText(String value) {
    if (_visibleController.text == value) return;
    _syncing = true;
    _visibleController.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
    _syncing = false;
  }

  void _setExternalText(String value, {required bool notify}) {
    if (widget.controller.text == value) {
      if (notify) widget.onChanged?.call(value);
      return;
    }
    _syncing = true;
    widget.controller.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
    _syncing = false;
    if (notify) widget.onChanged?.call(value);
  }

  void _syncVisibleFromExternal({bool writeInternationalValue = false}) {
    if (_syncing) return;
    final value = widget.controller.text;
    final inferred = CallingCodeCatalog.optionForPhoneNumber(
      value,
      fallbackCountryCode: _selected.countryCode,
    );
    if (inferred != null && inferred.countryCode != _selected.countryCode) {
      setState(() => _selected = inferred);
    }

    final option = inferred ?? _selected;
    final national = _nationalDigitsFromValue(value, option);
    _setVisibleText(national);

    if (writeInternationalValue &&
        national.isNotEmpty &&
        !PhoneNumberValidator.normalized(value).startsWith('+')) {
      _setExternalText(
        CallingCodeCatalog.composeInternationalPhone(
          callingCode: option.callingCode,
          nationalNumber: national,
        ),
        notify: false,
      );
    }
  }

  String _nationalDigitsFromValue(String value, PhoneCountryOption option) {
    final normalized = PhoneNumberValidator.normalized(value);
    final digits = PhoneNumberValidator.digitsOnly(normalized);
    if (digits.isEmpty) return '';
    if (normalized.startsWith('+') && digits.startsWith(option.callingCode)) {
      return digits.substring(option.callingCode.length);
    }
    return digits;
  }

  void _writeInternationalValueFromVisible({required bool notify}) {
    final digits = PhoneNumberValidator.digitsOnly(_visibleController.text);
    final formatted = digits.isEmpty
        ? ''
        : CallingCodeCatalog.composeInternationalPhone(
            callingCode: _selected.callingCode,
            nationalNumber: digits,
          );
    _setExternalText(formatted, notify: notify);
  }

  void _refreshClearButton() {
    if (widget.showClearButton) setState(() {});
  }

  void _handleChanged(String value) {
    if (_syncing) return;
    final normalized = PhoneNumberValidator.normalized(value);
    if (normalized.isEmpty) {
      _setExternalText('', notify: true);
      _refreshClearButton();
      return;
    }

    if (normalized.startsWith('+')) {
      final inferred = CallingCodeCatalog.optionForPhoneNumber(
        normalized,
        fallbackCountryCode: _selected.countryCode,
      );
      if (inferred != null && inferred.countryCode != _selected.countryCode) {
        setState(() => _selected = inferred);
      }
      final national = _nationalDigitsFromValue(
        normalized,
        inferred ?? _selected,
      );
      _setVisibleText(national);
      _writeInternationalValueFromVisible(notify: true);
      _refreshClearButton();
      return;
    }

    _writeInternationalValueFromVisible(notify: true);
    _refreshClearButton();
  }

  Future<void> _openCountryPicker() async {
    if (!widget.enabled) return;
    final option = await showModalBottomSheet<PhoneCountryOption>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _CountryCodeSheet(selected: _selected),
    );
    if (option == null || !mounted) return;

    setState(() => _selected = option);
    _writeInternationalValueFromVisible(notify: true);
  }

  void _clearPhone() {
    if (!widget.enabled) return;
    final initialOption =
        CallingCodeCatalog.optionForCountryCode(widget.initialCountryCode) ??
        CallingCodeCatalog.options.first;
    setState(() => _selected = initialOption);
    _setVisibleText('');
    _setExternalText('', notify: true);
  }

  @override
  Widget build(BuildContext context) {
    final baseDecoration = widget.decoration ?? const InputDecoration();
    final suffixIcon =
        widget.showClearButton &&
            widget.enabled &&
            _visibleController.text.isNotEmpty
        ? IconButton(
            onPressed: _clearPhone,
            icon: const Icon(Icons.clear_rounded),
            tooltip: MaterialLocalizations.of(context).deleteButtonTooltip,
          )
        : baseDecoration.suffixIcon;
    return TextFormField(
      key: widget.fieldKey,
      controller: _visibleController,
      enabled: widget.enabled,
      keyboardType: TextInputType.phone,
      textInputAction: widget.textInputAction,
      autofillHints: widget.autofillHints,
      inputFormatters: PhoneNumberValidator.allowedInputFormatters,
      validator: (_) => widget.validator?.call(widget.controller.text),
      onChanged: _handleChanged,
      decoration: baseDecoration.copyWith(
        labelText: baseDecoration.labelText ?? widget.labelText,
        hintText: baseDecoration.hintText ?? widget.hintText,
        helperText: baseDecoration.helperText ?? widget.helperText,
        errorText: widget.errorText ?? baseDecoration.errorText,
        suffixIcon: suffixIcon,
        prefixIcon: _CountryCodeButton(
          option: _selected,
          enabled: widget.enabled,
          onPressed: _openCountryPicker,
        ),
        prefixIconConstraints: const BoxConstraints(
          minWidth: 98,
          maxWidth: 132,
        ),
      ),
    );
  }
}

class _CountryCodeButton extends StatelessWidget {
  const _CountryCodeButton({
    required this.option,
    required this.enabled,
    required this.onPressed,
  });

  final PhoneCountryOption option;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 8, end: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        onTap: enabled ? onPressed : null,
        child: Container(
          height: 40,
          padding: const EdgeInsetsDirectional.only(start: 8, end: 6),
          decoration: BoxDecoration(
            color: enabled
                ? AppColors.mist.withValues(alpha: 0.55)
                : colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                option.country.flagEmoji,
                style: const TextStyle(fontSize: 18),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  option.dialCode,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: enabled ? AppColors.ink : AppColors.muted,
                  ),
                ),
              ),
              const SizedBox(width: 2),
              Icon(
                Icons.keyboard_arrow_down_rounded,
                size: 18,
                color: enabled ? AppColors.muted : colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CountryCodeSheet extends StatefulWidget {
  const _CountryCodeSheet({required this.selected});

  final PhoneCountryOption selected;

  @override
  State<_CountryCodeSheet> createState() => _CountryCodeSheetState();
}

class _CountryCodeSheetState extends State<_CountryCodeSheet> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<PhoneCountryOption> get _filteredOptions {
    final query = _query.trim().toLowerCase();
    final options = CallingCodeCatalog.options;
    if (query.isEmpty) return _orderedOptions(options);
    return _orderedOptions(
      options
          .where(
            (option) =>
                option.country.name.toLowerCase().contains(query) ||
                option.countryCode.toLowerCase().contains(query) ||
                option.callingCode.contains(query.replaceAll('+', '')),
          )
          .toList(growable: false),
    );
  }

  List<PhoneCountryOption> _orderedOptions(List<PhoneCountryOption> options) {
    const pinned = ['US', 'GN', 'SN', 'ML', 'CI', 'GM', 'SL', 'LR'];
    final ordered = [...options]
      ..sort((a, b) {
        final aPinned = pinned.indexOf(a.countryCode);
        final bPinned = pinned.indexOf(b.countryCode);
        if (aPinned != bPinned) {
          if (aPinned == -1) return 1;
          if (bPinned == -1) return -1;
          return aPinned.compareTo(bPinned);
        }
        return a.country.name.compareTo(b.country.name);
      });
    return ordered;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final options = _filteredOptions;
    final height = MediaQuery.sizeOf(context).height * 0.78;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: height,
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.rule,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.selectCountryCode,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                    tooltip: MaterialLocalizations.of(
                      context,
                    ).closeButtonTooltip,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: TextField(
                controller: _searchController,
                textInputAction: TextInputAction.search,
                onChanged: (value) => setState(() => _query = value),
                decoration: InputDecoration(
                  hintText: l10n.phoneCountrySearchHint,
                  prefixIcon: const Icon(Icons.search_rounded),
                ),
              ),
            ),
            Expanded(
              child: options.isEmpty
                  ? Center(
                      child: Text(
                        l10n.noCountryCodesFound,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    )
                  : ListView.separated(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      itemCount: options.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final option = options[index];
                        final selected =
                            option.countryCode == widget.selected.countryCode;
                        return ListTile(
                          leading: Text(
                            option.country.flagEmoji,
                            style: const TextStyle(fontSize: 24),
                          ),
                          title: Text(
                            option.country.name,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(option.countryCode),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                option.dialCode,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              if (selected) ...[
                                const SizedBox(width: 10),
                                const Icon(
                                  Icons.check_circle_rounded,
                                  color: AppColors.cobalt,
                                ),
                              ],
                            ],
                          ),
                          onTap: () => Navigator.pop(context, option),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
