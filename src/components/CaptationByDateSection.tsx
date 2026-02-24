'use client';

import React, { useState, useMemo, useRef } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const INITIAL_OPTIONS_SHOWN = 10;
const MAX_OPTIONS_WHEN_SEARCHING = 40;

function CaptationFilterSelect({ options, value, onChange, placeholder }: { options: string[]; value: string; onChange: (v: string) => void; placeholder: string }) {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return options.slice(0, INITIAL_OPTIONS_SHOWN);
        return options.filter((o) => o.toLowerCase().includes(q)).slice(0, MAX_OPTIONS_WHEN_SEARCHING);
    }, [options, search]);
    return (
        <div ref={containerRef} className="relative min-w-[180px]">
            <input
                type="text"
                value={value || ''}
                readOnly
                onClick={() => setOpen((o) => !o)}
                onBlur={() => setTimeout(() => { if (containerRef.current && !containerRef.current.contains(document.activeElement)) { setOpen(false); setSearch(''); } }, 150)}
                placeholder={!value ? placeholder : undefined}
                className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-900 bg-white w-full cursor-pointer"
            />
            {open && (
                <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded shadow-lg w-full overflow-hidden">
                    {options.length > INITIAL_OPTIONS_SHOWN && (
                        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar..."
                                className="text-sm w-full px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                autoFocus
                                onMouseDown={(e) => e.stopPropagation()}
                            />
                        </div>
                    )}
                    <ul className="max-h-48 overflow-y-auto py-1">
                        {filtered.length === 0 ? (
                            <li className="px-3 py-2 text-sm text-gray-500">Sin resultados</li>
                        ) : (
                            filtered.map((o) => (
                                <li
                                    key={o}
                                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 ${o === value ? 'bg-indigo-50 font-medium' : ''}`}
                                    onMouseDown={(e) => { e.preventDefault(); onChange(o); setSearch(''); setOpen(false); }}
                                >
                                    {o}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDateShort(value: string | Date | null | undefined): string {
    if (value == null) return '';
    const d = typeof value === 'string' ? new Date(value) : value;
    if (isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function formatCompact(value: number) {
    if (Math.abs(value) >= 1000) {
        return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    }
    return Math.round(value).toString();
}

type ChartMetrics = { leads: boolean; sales: boolean; conversion: boolean; revenue: boolean; cpl: boolean };

interface CaptationByDateSectionProps {
    salesByRegistrationDate: { date: string; leads: number; sales: number; revenue: number; gasto?: number; ads?: { anuncio: string; segmentacion: string; leads: number; sales: number; revenue: number; gasto: number }[] }[];
    salesByRegistrationDateByCountry?: Record<string, { country: string; leads: number; sales: number; revenue: number; gasto: number }[]>;
    captationByAnuncio?: Record<string, { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]>;
    captationBySegmentacion?: Record<string, { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]>;
    captationByPais?: Record<string, { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]>;
    captationByTrafficType?: { frio: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]; caliente: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]; otro: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[] };
}

export default function CaptationByDateSection({ salesByRegistrationDate: sbr, salesByRegistrationDateByCountry: byCountry, captationByAnuncio, captationBySegmentacion, captationByPais, captationByTrafficType }: CaptationByDateSectionProps) {
    const [captationFilterBy, setCaptationFilterBy] = useState<'todos' | 'anuncio' | 'segmentacion' | 'pais' | 'traffic'>('todos');
    const [captationFilterValue, setCaptationFilterValue] = useState<string>('');
    const [chartMetrics, setChartMetrics] = useState<ChartMetrics>({ leads: true, sales: true, conversion: true, revenue: true, cpl: false });
    const [modalDateRow, setModalDateRow] = useState<{ date: string; ads: any[] } | null>(null);
    const [modalViewBy, setModalViewBy] = useState<'anuncio' | 'segmentacion'>('anuncio');
    const [modalSortBy, setModalSortBy] = useState<string>('revenue');
    const [modalSortDir, setModalSortDir] = useState<'asc' | 'desc'>('desc');

    const captationFilterOptions = useMemo(() => {
        const anunciosGasto: Record<string, number> = {};
        const segmentacionesGasto: Record<string, number> = {};
        const paisesGasto: Record<string, number> = {};
        for (const row of sbr) {
            for (const ad of row.ads || []) {
                const g = ad.gasto ?? 0;
                if (ad.anuncio) anunciosGasto[ad.anuncio] = (anunciosGasto[ad.anuncio] ?? 0) + g;
                if (ad.segmentacion) segmentacionesGasto[ad.segmentacion] = (segmentacionesGasto[ad.segmentacion] ?? 0) + g;
            }
        }
        if (byCountry) {
            for (const countries of Object.values(byCountry)) {
                for (const c of countries) {
                    if (c.country) paisesGasto[c.country] = (paisesGasto[c.country] ?? 0) + (c.gasto ?? 0);
                }
            }
        }
        const sortByGasto = (a: string, b: string, map: Record<string, number>) => {
            const ga = map[a] ?? 0, gb = map[b] ?? 0;
            return gb !== ga ? gb - ga : a.localeCompare(b);
        };
        return {
            anuncios: Object.keys(anunciosGasto).sort((a, b) => sortByGasto(a, b, anunciosGasto)),
            segmentaciones: Object.keys(segmentacionesGasto).sort((a, b) => sortByGasto(a, b, segmentacionesGasto)),
            paises: Object.keys(paisesGasto).sort((a, b) => sortByGasto(a, b, paisesGasto)),
            trafficTypes: captationByTrafficType ? ['Frío (PF)', 'Caliente (PQ)', 'Otro'] : []
        };
    }, [sbr, byCountry, captationByTrafficType]);

    const captationChartData = useMemo(() => {
        if (!sbr) return [];
        if (captationFilterBy === 'todos' || !captationFilterValue) {
            return sbr.map((r) => ({ ...r, gasto: r.gasto ?? 0 }));
        }
        if (captationFilterBy === 'traffic' && captationByTrafficType) {
            const key = captationFilterValue === 'Frío (PF)' ? 'frio' : captationFilterValue === 'Caliente (PQ)' ? 'caliente' : 'otro';
            return captationByTrafficType[key] || [];
        }
        if (captationFilterBy === 'anuncio' && captationByAnuncio?.[captationFilterValue]) {
            return captationByAnuncio[captationFilterValue];
        }
        if (captationFilterBy === 'segmentacion' && captationBySegmentacion?.[captationFilterValue]) {
            return captationBySegmentacion[captationFilterValue];
        }
        if (captationFilterBy === 'pais' && captationByPais?.[captationFilterValue]) {
            return captationByPais[captationFilterValue];
        }
        if (captationFilterBy === 'anuncio' || captationFilterBy === 'segmentacion') {
            return sbr.map((row) => {
                const filtered = (row.ads || []).filter((ad) =>
                    captationFilterBy === 'anuncio' ? ad.anuncio === captationFilterValue : ad.segmentacion === captationFilterValue
                );
                const leads = filtered.reduce((s, a) => s + a.leads, 0);
                const sales = filtered.reduce((s, a) => s + a.sales, 0);
                const revenue = filtered.reduce((s, a) => s + a.revenue, 0);
                const gasto = filtered.reduce((s, a) => s + (a.gasto || 0), 0);
                return {
                    date: row.date,
                    leads,
                    sales,
                    revenue,
                    gasto,
                    cpl: leads > 0 ? gasto / leads : 0,
                    ads: filtered.length > 0 ? filtered : undefined
                };
            });
        }
        if (captationFilterBy === 'pais' && byCountry) {
            const allDates = new Set([...sbr.map((r) => r.date), ...Object.keys(byCountry)]);
            return Array.from(allDates)
                .sort()
                .map((dateStr) => {
                    const countries = byCountry[dateStr] || [];
                    const match = countries.find((c) => c.country === captationFilterValue);
                    if (!match) return { date: dateStr, leads: 0, sales: 0, revenue: 0, gasto: 0, cpl: 0 };
                    const gasto = match.gasto ?? 0;
                    return {
                        date: dateStr,
                        leads: match.leads,
                        sales: match.sales,
                        revenue: match.revenue,
                        gasto,
                        cpl: match.leads > 0 ? gasto / match.leads : 0
                    };
                });
        }
        return sbr.map((r) => ({ ...r, gasto: r.gasto ?? 0 }));
    }, [sbr, byCountry, captationFilterBy, captationFilterValue, captationByAnuncio, captationBySegmentacion, captationByPais, captationByTrafficType]);

    const { chartDataForRecharts, convMax, cplMax } = useMemo(() => {
        const data = captationChartData.map((r: any) => ({
            ...r,
            label: formatDateShort(r.date),
            conversion: r.leads > 0 ? Math.round((r.sales / r.leads) * 1000) / 10 : 0,
            cpl: r.leads > 0 ? (r.gasto ?? 0) / r.leads : 0
        }));
        const convs = captationChartData
            .map((r: any) => r.leads > 0 ? (r.sales / r.leads) * 100 : 0)
            .filter((v: number) => v > 0)
            .sort((a: number, b: number) => a - b);
        const convMed = convs.length > 0 ? convs[Math.floor(convs.length / 2)] : 0;
        const convMax = Math.min(100, Math.ceil(Math.max(3, convMed * 3.5)));
        const cpls = captationChartData
            .map((r: any) => r.leads > 0 ? (r.gasto ?? 0) / r.leads : 0)
            .filter((v: number) => v > 0)
            .sort((a: number, b: number) => a - b);
        const cplMed = cpls.length > 0 ? cpls[Math.floor(cpls.length / 2)] : 0;
        const cplMax = Math.min(100000, Math.ceil(Math.max(1, cplMed * 3.5)));
        return { chartDataForRecharts: data, convMax, cplMax };
    }, [captationChartData]);

    return (
        <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-2 text-indigo-800">Ventas por Fecha de Registro</h3>
            <p className="text-sm text-gray-700 mb-4">
                Cuántas personas se registraron cada día y cuántas de ellas compraron. Útil para ver si los que se registraron en ciertas fechas (ej. antes del evento) compraron más que los que se registraron después.
            </p>
            <div className="flex flex-wrap items-center gap-4 mb-4">
                <span className="text-sm font-medium text-gray-700">Ver captación por:</span>
                <select
                    value={captationFilterBy}
                    onChange={(e) => { setCaptationFilterBy(e.target.value as any); setCaptationFilterValue(''); }}
                    className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-900 bg-white"
                >
                    <option value="todos">Todos</option>
                    <option value="anuncio">Anuncio</option>
                    <option value="segmentacion">Segmentación</option>
                    {captationFilterOptions.paises.length > 0 && <option value="pais">País</option>}
                    {captationFilterOptions.trafficTypes.length > 0 && <option value="traffic">Tipo de tráfico</option>}
                </select>
                {captationFilterBy !== 'todos' && (
                    captationFilterBy === 'traffic' ? (
                        <select
                            value={captationFilterValue}
                            onChange={(e) => setCaptationFilterValue(e.target.value)}
                            className="text-sm border border-gray-300 rounded px-3 py-1.5 text-gray-900 bg-white"
                        >
                            <option value="">Selecciona tipo</option>
                            {captationFilterOptions.trafficTypes.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    ) : (
                        <CaptationFilterSelect
                            options={captationFilterBy === 'anuncio' ? captationFilterOptions.anuncios : captationFilterBy === 'segmentacion' ? captationFilterOptions.segmentaciones : captationFilterOptions.paises}
                            value={captationFilterValue}
                            onChange={setCaptationFilterValue}
                            placeholder={`Selecciona ${captationFilterBy === 'anuncio' ? 'anuncio' : captationFilterBy === 'segmentacion' ? 'segmentación' : 'país'}`}
                        />
                    )
                )}
            </div>
            <div className="flex flex-wrap gap-4 mb-4">
                {(['leads', 'sales', 'conversion', 'revenue', 'cpl'] as const).map((k) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={chartMetrics[k]} onChange={(e) => setChartMetrics(m => ({ ...m, [k]: e.target.checked }))} className="rounded" />
                        <span className="text-sm font-medium text-gray-700">
                            {k === 'leads' ? 'Registros' : k === 'sales' ? 'Compraron' : k === 'conversion' ? 'Conversión %' : k === 'revenue' ? 'Ingresos' : 'Costo por Lead'}
                        </span>
                    </label>
                ))}
            </div>
            <div className="h-[400px] w-full mb-6">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart key={`${captationFilterBy}-${captationFilterValue}`} data={chartDataForRecharts} margin={{ top: 20, right: 165, left: 20, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'Registros', angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: 'Compraron', angle: 90, position: 'insideRight' }} />
                        <YAxis yAxisId="right2" orientation="right" domain={[0, convMax]} allowDataOverflow tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={45} label={{ value: 'Conv. %', angle: 90, position: 'insideRight', offset: 0 }} />
                        <YAxis yAxisId="ingresos" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompact(v)} width={50} />
                        <YAxis yAxisId="cpl" orientation="right" domain={[0, cplMax]} allowDataOverflow tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompact(v)} width={45} />
                        <Tooltip content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0]?.payload;
                            const conv = d?.leads > 0 ? ((d?.sales / d?.leads) * 100).toFixed(1) : '0';
                            return (
                                <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-sm text-gray-900">
                                    <p className="font-semibold mb-2 text-gray-900">{formatDateShort(d?.date)}</p>
                                    <p>Registros: <strong>{d?.leads ?? 0}</strong></p>
                                    <p>Compraron: <strong>{d?.sales ?? 0}</strong></p>
                                    <p>Conversión: <strong>{conv}%</strong></p>
                                    <p>Ingresos: <strong>{formatCurrency(d?.revenue ?? 0)}</strong></p>
                                    <p>Gasto: <strong>{formatCurrency(d?.gasto ?? 0)}</strong></p>
                                    <p>Costo por Lead: <strong>{formatCurrency(d?.cpl ?? 0)}</strong></p>
                                </div>
                            );
                        }} />
                        <Legend />
                        {chartMetrics.leads && <Bar yAxisId="left" dataKey="leads" name="Registros" fill="#94a3b8" radius={[4, 4, 0, 0]} />}
                        {chartMetrics.sales && <Bar yAxisId="right" dataKey="sales" name="Compraron" fill="#6366f1" radius={[4, 4, 0, 0]} />}
                        {chartMetrics.conversion && <Line yAxisId="right2" type="monotone" dataKey="conversion" name="Conversión %" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />}
                        {chartMetrics.revenue && <Line yAxisId="ingresos" type="monotone" dataKey="revenue" name="Ingresos" stroke="#eab308" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />}
                        {chartMetrics.cpl && <Line yAxisId="cpl" type="monotone" dataKey="cpl" name="Costo por Lead" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="3 3" />}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left font-semibold text-gray-800">Fecha de Registro</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Registros</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Compraron</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Conversión</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Gasto</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Costo/Lead</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Ingresos</th>
                            <th className="px-4 py-3 text-center font-semibold text-gray-800 w-12"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {captationChartData.map((row: any) => (
                            <tr key={row.date} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-medium text-gray-900">{formatDateShort(row.date)}</td>
                                <td className="px-4 py-3 text-right text-gray-700">{row.leads}</td>
                                <td className="px-4 py-3 text-right font-semibold text-indigo-600">{row.sales}</td>
                                <td className="px-4 py-3 text-right">{row.leads > 0 ? ((row.sales / row.leads) * 100).toFixed(1) : 0}%</td>
                                <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.gasto ?? 0)}</td>
                                <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(row.leads > 0 ? (row.gasto ?? 0) / row.leads : 0)}</td>
                                <td className="px-4 py-3 text-right text-green-600">{formatCurrency(row.revenue)}</td>
                                <td className="px-4 py-3 text-center">
                                    {row.ads && row.ads.length > 0 ? (
                                        <button type="button" onClick={() => { setModalDateRow({ date: row.date, ads: row.ads }); setModalViewBy('anuncio'); setModalSortBy('revenue'); setModalSortDir('desc'); }} className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50 transition-colors" title="Ver anuncios">
                                            <ChevronDown className="h-4 w-4" />
                                        </button>
                                    ) : (
                                        <span className="text-gray-300">—</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {modalDateRow && (() => {
                const grouped = (modalViewBy === 'anuncio'
                    ? Object.entries(modalDateRow.ads.reduce((acc: Record<string, { leads: number; sales: number; revenue: number; gasto: number }>, ad: any) => {
                        const k = ad.anuncio || 'Sin anuncio';
                        if (!acc[k]) acc[k] = { leads: 0, sales: 0, revenue: 0, gasto: 0 };
                        acc[k].leads += ad.leads;
                        acc[k].sales += ad.sales;
                        acc[k].revenue += (ad.revenue ?? 0);
                        acc[k].gasto += (ad.gasto ?? 0);
                        return acc;
                    }, {})).map(([name, data]) => ({ name, ...data, roas: data.gasto > 0 ? data.revenue / data.gasto : 0, cpl: data.leads > 0 ? data.gasto / data.leads : 0 }))
                    : Object.entries(modalDateRow.ads.reduce((acc: Record<string, { leads: number; sales: number; revenue: number; gasto: number }>, ad: any) => {
                        const k = ad.segmentacion || 'Sin segmentación';
                        if (!acc[k]) acc[k] = { leads: 0, sales: 0, revenue: 0, gasto: 0 };
                        acc[k].leads += ad.leads;
                        acc[k].sales += ad.sales;
                        acc[k].revenue += (ad.revenue ?? 0);
                        acc[k].gasto += (ad.gasto ?? 0);
                        return acc;
                    }, {})).map(([name, data]) => ({ name, ...data, roas: data.gasto > 0 ? data.revenue / data.gasto : 0, cpl: data.leads > 0 ? data.gasto / data.leads : 0 }))
                );
                const sorted = [...grouped].sort((a: any, b: any) => {
                    const va = a[modalSortBy];
                    const vb = b[modalSortBy];
                    const cmp = typeof va === 'string' ? (va ?? '').localeCompare(vb ?? '') : (Number(va) ?? 0) - (Number(vb) ?? 0);
                    return modalSortDir === 'asc' ? cmp : -cmp;
                });
                const toggleModalSort = (key: string) => {
                    if (modalSortBy === key) setModalSortDir(d => d === 'asc' ? 'desc' : 'asc');
                    else { setModalSortBy(key); setModalSortDir('desc'); }
                };
                const cols = [
                    { key: 'name', label: modalViewBy === 'anuncio' ? 'Anuncio' : 'Segmentación', align: 'left' as const },
                    { key: 'leads', label: 'Registros', align: 'right' as const },
                    { key: 'sales', label: 'Compraron', align: 'right' as const },
                    { key: 'gasto', label: 'Gasto', align: 'right' as const },
                    { key: 'cpl', label: 'Costo/Lead', align: 'right' as const },
                    { key: 'revenue', label: 'Ingresos', align: 'right' as const },
                    { key: 'roas', label: 'ROAS', align: 'right' as const },
                ];
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModalDateRow(null)}>
                        <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between p-4 border-b">
                                <h3 className="text-lg font-semibold text-gray-900">Detalle del {formatDateShort(modalDateRow.date)}</h3>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <span className="text-sm font-medium text-gray-700">Anuncio</span>
                                        <button type="button" role="switch" aria-checked={modalViewBy === 'segmentacion'} onClick={() => setModalViewBy(v => v === 'anuncio' ? 'segmentacion' : 'anuncio')} className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${modalViewBy === 'segmentacion' ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${modalViewBy === 'segmentacion' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </button>
                                        <span className="text-sm font-medium text-gray-700">Segmentación</span>
                                    </label>
                                    <button type="button" onClick={() => setModalDateRow(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                            <div className="overflow-auto max-h-[60vh]">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            {cols.map(({ key, label, align }) => (
                                                <th key={key} className={`px-4 py-2 font-semibold text-gray-800 cursor-pointer select-none hover:bg-gray-100 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`} onClick={() => toggleModalSort(key)}>
                                                    <span className="inline-flex items-center gap-1">
                                                        {label}
                                                        {modalSortBy === key && <span className="text-indigo-600">{modalSortDir === 'asc' ? '↑' : '↓'}</span>}
                                                    </span>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {sorted.map((row: any, i: number) => (
                                            <tr key={i} className="hover:bg-gray-50">
                                                <td className="px-4 py-2 font-medium text-gray-900">{row.name}</td>
                                                <td className="px-4 py-2 text-right text-gray-700">{row.leads}</td>
                                                <td className="px-4 py-2 text-right font-semibold text-indigo-600">{row.sales}</td>
                                                <td className="px-4 py-2 text-right text-red-600">{formatCurrency(row.gasto)}</td>
                                                <td className="px-4 py-2 text-right text-orange-600">{formatCurrency(row.cpl)}</td>
                                                <td className="px-4 py-2 text-right text-green-600">{formatCurrency(row.revenue)}</td>
                                                <td className={`px-4 py-2 text-right font-bold ${row.roas >= 2 ? 'text-green-600' : row.roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>{row.roas.toFixed(2)}x</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
