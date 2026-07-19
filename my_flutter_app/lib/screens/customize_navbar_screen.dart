import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/customer_service_catalog.dart';
import '../services/nav_prefs.dart';
import '../theme/app_colors.dart';

/// Lets the customer choose, reorder and remove the services pinned to their
/// bottom navbar. Changes persist immediately.
class CustomizeNavbarScreen extends StatefulWidget {
  const CustomizeNavbarScreen({super.key});

  @override
  State<CustomizeNavbarScreen> createState() => _CustomizeNavbarScreenState();
}

class _CustomizeNavbarScreenState extends State<CustomizeNavbarScreen> {
  final _navPrefs = NavPrefs();
  List<String> _pinned = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final pinned = await _navPrefs.pinned();
    if (!mounted) return;
    setState(() {
      _pinned = pinned;
      _loading = false;
    });
  }

  void _save() => _navPrefs.setPinned(_pinned);

  void _remove(String id) {
    setState(() => _pinned = List.of(_pinned)..remove(id));
    _save();
  }

  void _add(String id) {
    if (_pinned.length >= maxPinnedServices) return;
    setState(() => _pinned = List.of(_pinned)..add(id));
    _save();
  }

  void _reorder(int oldIndex, int newIndex) {
    setState(() {
      final list = List.of(_pinned);
      final item = list.removeAt(oldIndex);
      list.insert(newIndex, item);
      _pinned = list;
    });
    _save();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    final full = _pinned.length >= maxPinnedServices;
    final available = customerServiceCatalog
        .where((s) => !_pinned.contains(s.id))
        .toList();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.customizeNavbar)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
              children: [
                Text(
                  l10n.navbarPickerInstructions(maxPinnedServices),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  l10n.inYourNavbar,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                if (_pinned.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      l10n.nothingPinnedYet,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                  )
                else
                  ReorderableListView(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    onReorderItem: _reorder,
                    children: [
                      for (final id in _pinned)
                        Card(
                          key: ValueKey(id),
                          margin: const EdgeInsets.only(bottom: 8),
                          child: ListTile(
                            leading: Icon(
                              serviceById(id)!.icon,
                              color: AppColors.cobalt,
                            ),
                            title: Text(serviceById(id)!.label),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  icon: const Icon(Icons.remove_circle_outline),
                                  color: AppColors.muted,
                                  onPressed: () => _remove(id),
                                ),
                                const Icon(Icons.drag_handle),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                const SizedBox(height: 20),
                Text(
                  l10n.addServices,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                for (final s in available)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: Icon(s.icon, color: AppColors.muted),
                      title: Text(s.label),
                      trailing: IconButton(
                        icon: const Icon(Icons.add_circle_outline),
                        color: full ? AppColors.rule : AppColors.cobalt,
                        onPressed: full ? null : () => _add(s.id),
                      ),
                    ),
                  ),
                if (full)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      l10n.navbarFullMessage(maxPinnedServices),
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}
