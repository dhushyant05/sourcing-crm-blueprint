import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../data/models/models.dart';
import '../../services/session.dart';
import '../widgets/common.dart';

/// Steps 8-9: China enters forwarder/tracking updates, India reads them.
class ShippingScreen extends StatefulWidget {
  const ShippingScreen({super.key, this.leadId});
  final String? leadId;
  @override
  State<ShippingScreen> createState() => _ShippingScreenState();
}

class _ShippingScreenState extends State<ShippingScreen> {
  late Future<List<ShippingOrder>> _f;
  @override
  void initState() {
    super.initState();
    _f = context.read<Session>().repo.shippingOrders(leadId: widget.leadId);
  }

  void _reload() => setState(() => _f = context.read<Session>().repo.shippingOrders(leadId: widget.leadId));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Shipping tracker')),
      body: RefreshIndicator(
        onRefresh: () async => _reload(),
        child: AsyncView<List<ShippingOrder>>(
          future: _f,
          onRetry: _reload,
          builder: (c, list) => list.isEmpty
              ? ListView(children: const [SizedBox(height: 120), Center(child: Text('No shipments yet'))])
              : ListView(
                  children: list
                      .map((o) => Card(
                            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            child: ListTile(
                              leading: const Icon(Icons.directions_boat_outlined),
                              title: Text(o.trackingNumber ?? o.name),
                              subtitle: Text('${o.forwarder ?? 'Forwarder TBD'} · ETA ${o.eta != null ? dateFmt.format(o.eta!) : '—'}'),
                              trailing: StatusChip(o.shipmentStatus ?? 'BOOKED'),
                              onTap: () async {
                                await Navigator.push(c, MaterialPageRoute(builder: (_) => ShipmentDetailScreen(order: o)));
                                _reload();
                              },
                            ),
                          ))
                      .toList(),
                ),
        ),
      ),
    );
  }
}

const shipmentSteps = ['BOOKED', 'IN_TRANSIT', 'AT_PORT', 'OUT_FOR_DELIVERY', 'DELIVERED'];

class ShipmentDetailScreen extends StatelessWidget {
  const ShipmentDetailScreen({super.key, required this.order});
  final ShippingOrder order;

  @override
  Widget build(BuildContext context) {
    final p = context.watch<Session>().perms;
    final o = order;
    final step = shipmentSteps.indexOf(o.shipmentStatus ?? 'BOOKED');
    final hasPos = o.latitude != null && o.longitude != null;
    return Scaffold(
      appBar: AppBar(title: Text(o.trackingNumber ?? 'Shipment'), actions: [
        if (p.canEditShipping)
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: () async {
              final changed = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ShipmentEditScreen(order: o)));
              if (changed == true && context.mounted) Navigator.pop(context);
            },
          ),
      ]),
      body: ListView(children: [
        SizedBox(
          height: 220,
          child: FlutterMap(
            options: MapOptions(
              initialCenter: hasPos ? LatLng(o.latitude!, o.longitude!) : const LatLng(18, 95), // China–India corridor
              initialZoom: hasPos ? 5 : 3,
            ),
            children: [
              TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'in.sourceec.source_easy'),
              if (hasPos)
                MarkerLayer(markers: [
                  Marker(point: LatLng(o.latitude!, o.longitude!), child: const Icon(Icons.location_on, color: Colors.red, size: 36)),
                ]),
              const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Stepper(
              physics: const NeverScrollableScrollPhysics(),
              currentStep: step < 0 ? 0 : step,
              controlsBuilder: (_, _) => const SizedBox.shrink(),
              steps: shipmentSteps
                  .map((s) => Step(title: Text(pretty(s)), content: const SizedBox.shrink(),
                      isActive: shipmentSteps.indexOf(s) <= step,
                      state: shipmentSteps.indexOf(s) < step ? StepState.complete : StepState.indexed))
                  .toList(),
            ),
            InfoRow('Forwarder', o.forwarder),
            InfoRow('Tracking no.', o.trackingNumber),
            InfoRow('Container', pretty(o.containerType)),
            InfoRow('ETD', o.etd != null ? dateFmt.format(o.etd!) : null),
            InfoRow('ETA', o.eta != null ? dateFmt.format(o.eta!) : null),
            InfoRow('Customs', pretty(o.customsStatus)),
            InfoRow('Location', o.currentLocation),
          ]),
        ),
      ]),
    );
  }
}

class ShipmentEditScreen extends StatefulWidget {
  const ShipmentEditScreen({super.key, required this.order});
  final ShippingOrder order;
  @override
  State<ShipmentEditScreen> createState() => _ShipmentEditScreenState();
}

class _ShipmentEditScreenState extends State<ShipmentEditScreen> {
  late final _fwd = TextEditingController(text: widget.order.forwarder);
  late final _trk = TextEditingController(text: widget.order.trackingNumber);
  late final _loc = TextEditingController(text: widget.order.currentLocation);
  late final _lat = TextEditingController(text: widget.order.latitude?.toString());
  late final _lng = TextEditingController(text: widget.order.longitude?.toString());
  late String _status = widget.order.shipmentStatus ?? 'BOOKED';
  late String _customs = widget.order.customsStatus ?? 'NOT_STARTED';
  late String? _container = widget.order.containerType;
  late DateTime? _etd = widget.order.etd, _eta = widget.order.eta;

  String? _d(DateTime? d) => d?.toIso8601String().substring(0, 10);

  Future<void> _save() async {
    final s = context.read<Session>();
    final r = await s.repo.updateShipping(widget.order.id, {
      'forwarder': _fwd.text.trim(),
      'trackingNumber': _trk.text.trim(),
      'currentLocation': _loc.text.trim(),
      'latitude': double.tryParse(_lat.text),
      'longitude': double.tryParse(_lng.text),
      'shipmentStatus': _status,
      'customsStatus': _customs,
      'containerType': ?_container,
      'etd': _d(_etd),
      'eta': _d(_eta),
    });
    if (_status == 'DELIVERED' && widget.order.leadId != null) {
      await s.repo.updateLead(widget.order.leadId!, {'status': 'DELIVERED'});
    }
    await s.refreshPending();
    if (!mounted) return;
    showWriteResult(context, r, 'Shipment');
    Navigator.pop(context, true);
  }

  Widget _date(String label, DateTime? v, ValueChanged<DateTime> set) => ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text('$label: ${v != null ? dateFmt.format(v) : '—'}'),
        trailing: const Icon(Icons.event),
        onTap: () async {
          final d = await showDatePicker(context: context, initialDate: v ?? DateTime.now(),
              firstDate: DateTime(2024), lastDate: DateTime(2030));
          if (d != null) setState(() => set(d));
        },
      );

  Widget _select(String label, String? value, List<String> opts, ValueChanged<String> set) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: DropdownButtonFormField<String>(
          initialValue: value,
          decoration: InputDecoration(labelText: label),
          items: opts.map((o) => DropdownMenuItem(value: o, child: Text(pretty(o)))).toList(),
          onChanged: (v) => setState(() => set(v!)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: const Text('Update shipment')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _fwd, decoration: const InputDecoration(labelText: 'Forwarder')),
        gap,
        TextField(controller: _trk, decoration: const InputDecoration(labelText: 'Tracking number')),
        gap,
        _select('Status', _status, shipmentSteps, (v) => _status = v),
        _select('Customs', _customs, const ['NOT_STARTED', 'FILED', 'HELD', 'CLEARED'], (v) => _customs = v),
        _select('Container', _container, const ['LCL', 'FCL_20', 'FCL_40', 'FCL_40HC', 'AIR', 'COURIER'], (v) => _container = v),
        _date('ETD', _etd, (d) => _etd = d),
        _date('ETA', _eta, (d) => _eta = d),
        TextField(controller: _loc, decoration: const InputDecoration(labelText: 'Current location')),
        gap,
        Row(children: [
          Expanded(child: TextField(controller: _lat, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: const InputDecoration(labelText: 'Latitude'))),
          const SizedBox(width: 12),
          Expanded(child: TextField(controller: _lng, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: const InputDecoration(labelText: 'Longitude'))),
        ]),
        const SizedBox(height: 24),
        FilledButton.icon(onPressed: _save, icon: const Icon(Icons.save), label: const Text('Save update')),
      ]),
    );
  }
}
