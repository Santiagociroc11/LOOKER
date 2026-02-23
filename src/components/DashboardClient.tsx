'use client';

import React, { useState, useMemo } from 'react';
import { getAvailableTables, processDashboardData } from '@/app/actions/dashboardActions';
import { RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatCompact(value: number) {
    if (Math.abs(value) >= 1000) {
        return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    }
    return Math.round(value).toString();
}

export default function DashboardClient({ initialTables }: { initialTables: string[] }) {
    const [tables, setTables] = useState<string[]>(initialTables);
    const [baseTable, setBaseTable] = useState('');
    const [salesTable, setSalesTable] = useState('');
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [countryCsvFile, setCountryCsvFile] = useState<File | null>(null);
    const [exchangeRate, setExchangeRate] = useState('0');
    const [multiplyRevenue, setMultiplyRevenue] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [dashboardData, setDashboardData] = useState<any>(null);

    const [activeTab, setActiveTab] = useState<'general' | 'quality' | 'factors' | 'countries' | 'captation'>('general');
    const [perspective, setPerspective] = useState<'ads' | 'segments'>('ads');
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState('profit');
    const [detailSortBy, setDetailSortBy] = useState('profit');

    const handleProcess = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!baseTable || !salesTable || !csvFile) {
            setError('Por favor completa todos los campos requeridos.');
            return;
        }
        setError('');
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append('base_table', baseTable);
            formData.append('sales_table', salesTable);
            formData.append('spend_report', csvFile);
            formData.append('exchange_rate', exchangeRate);
            if (multiplyRevenue) formData.append('multiply_revenue', '1');
            if (countryCsvFile) formData.append('country_report', countryCsvFile);

            const result = await processDashboardData(formData);
            setDashboardData(result);
            setActiveTab('general');
            setPerspective('ads');
            setSelectedKeys(new Set(Object.keys(result.ads)));
            setLastSelectedKey(null);
        } catch (err: any) {
            setError(err.message || 'Error desconocido procesando los datos.');
        } finally {
            setIsLoading(false);
        }
    };

    const segmentationData = useMemo(() => {
        if (!dashboardData?.ads) return null;
        const segments: Record<string, any> = {};
        for (const [adKey, ad] of Object.entries<any>(dashboardData.ads)) {
            if (adKey === 'organica') {
                segments['organica'] = {
                    key: 'organica',
                    name: 'Orgánica',
                    total_revenue: ad.total_revenue,
                    total_leads: 0,
                    total_sales: ad.total_sales,
                    total_spend: 0,
                    roas: 0,
                    profit: ad.total_revenue,
                    ads: [{ key: 'organica', name: 'Orgánica', ...ad.segmentations[0] }]
                };
                continue;
            }
            for (const seg of ad.segmentations) {
                const segKey = seg.name.toLowerCase().trim();
                if (!segments[segKey]) {
                    segments[segKey] = {
                        key: segKey,
                        name: seg.name,
                        total_revenue: 0,
                        total_leads: 0,
                        total_sales: 0,
                        total_spend: 0,
                        ads: []
                    };
                }
                segments[segKey].total_revenue += seg.revenue;
                segments[segKey].total_leads += seg.leads;
                segments[segKey].total_sales += seg.sales;
                segments[segKey].total_spend += (seg.spend_allocated || 0);
                segments[segKey].ads.push({
                    key: adKey,
                    name: ad.ad_name_display,
                    revenue: seg.revenue,
                    leads: seg.leads,
                    sales: seg.sales,
                    spend_allocated: seg.spend_allocated,
                    profit: seg.profit,
                    conversion_rate: seg.conversion_rate,
                    cpl: seg.cpl
                });
            }
        }
        for (const seg of Object.values(segments)) {
            seg.conversion_rate = seg.total_leads > 0 ? (seg.total_sales / seg.total_leads) * 100 : 0;
            seg.roas = seg.total_spend > 0 ? seg.total_revenue / seg.total_spend : 0;
            seg.profit = seg.total_revenue - seg.total_spend;
            seg.cpl = seg.total_leads > 0 ? seg.total_spend / seg.total_leads : 0;
        }
        return segments;
    }, [dashboardData]);

    const mainListItems = useMemo(() => {
        if (!dashboardData?.ads) return [];
        if (perspective === 'ads') {
            return Object.entries(dashboardData.ads).map(([key, ad]: [string, any]) => ({
                key,
                name: ad.ad_name_display,
                total_revenue: ad.total_revenue,
                total_spend: ad.total_spend,
                profit: ad.profit,
                roas: ad.roas
            }));
        }
        if (!segmentationData) return [];
        return Object.values(segmentationData).map((seg: any) => ({
            key: seg.key,
            name: seg.name,
            total_revenue: seg.total_revenue,
            total_spend: seg.total_spend,
            profit: seg.profit,
            roas: seg.roas
        }));
    }, [dashboardData, perspective, segmentationData]);

    const sortedMainList = useMemo(() => {
        const sorted = [...mainListItems];
        const sortMap: Record<string, (a: any, b: any) => number> = {
            profit: (a, b) => b.profit - a.profit,
            revenue: (a, b) => b.total_revenue - a.total_revenue,
            spend: (a, b) => b.total_spend - a.total_spend,
            roas: (a, b) => b.roas - a.roas,
            name: (a, b) => a.name.localeCompare(b.name)
        };
        sorted.sort(sortMap[sortBy] || sortMap.profit);
        return sorted;
    }, [mainListItems, sortBy]);

    const selectedDetails = useMemo(() => {
        if (!dashboardData?.ads || selectedKeys.size === 0) return null;
        let totalLeads = 0, totalSales = 0, totalRevenue = 0, totalSpend = 0;
        const combinedDetails: any[] = [];

        if (perspective === 'ads') {
            for (const key of selectedKeys) {
                const ad = dashboardData.ads[key];
                if (!ad) continue;
                totalLeads += ad.total_leads;
                totalSales += ad.total_sales;
                totalRevenue += ad.total_revenue;
                totalSpend += ad.total_spend;
                combinedDetails.push(...ad.segmentations.map((s: any) => ({ ...s, spend_allocated: s.spend_allocated })));
            }
        } else if (segmentationData) {
            for (const key of selectedKeys) {
                const seg = segmentationData[key];
                if (!seg) continue;
                totalLeads += seg.total_leads;
                totalSales += seg.total_sales;
                totalRevenue += seg.total_revenue;
                totalSpend += seg.total_spend;
                combinedDetails.push(...seg.ads.map((a: any) => ({
                    name: a.name,
                    leads: a.leads,
                    sales: a.sales,
                    revenue: a.revenue,
                    spend_allocated: a.spend_allocated,
                    profit: a.profit,
                    conversion_rate: a.conversion_rate,
                    cpl: a.cpl
                })));
            }
        }

        const grouped = combinedDetails.reduce((acc: Record<string, any>, d) => {
            const n = (d.name || '').toLowerCase().trim();
            if (!acc[n]) acc[n] = { ...d };
            else {
                acc[n].leads += d.leads || 0;
                acc[n].sales += d.sales || 0;
                acc[n].revenue += d.revenue || 0;
                acc[n].spend_allocated = (acc[n].spend_allocated || 0) + (d.spend_allocated || 0);
                acc[n].profit = (acc[n].profit || 0) + (d.profit || 0);
            }
            return acc;
        }, {});
        const details = Object.values(grouped).map((d: any) => ({
            ...d,
            conversion_rate: d.leads > 0 ? (d.sales / d.leads) * 100 : 0
        }));

        const sortMap: Record<string, (a: any, b: any) => number> = {
            profit: (a, b) => (b.profit || 0) - (a.profit || 0),
            revenue: (a, b) => (b.revenue || 0) - (a.revenue || 0),
            leads: (a, b) => (b.leads || 0) - (a.leads || 0),
            name: (a, b) => (a.name || '').localeCompare(b.name || '')
        };
        details.sort(sortMap[detailSortBy] || sortMap.profit);

        return {
            totalLeads,
            totalSales,
            totalRevenue,
            totalSpend,
            details
        };
    }, [dashboardData, segmentationData, perspective, selectedKeys, detailSortBy]);

    const summaryForSelection = useMemo(() => {
        if (selectedKeys.size === 0 && dashboardData?.summary) {
            return {
                total_revenue: dashboardData.summary.totalRevenueAll,
                total_spend: dashboardData.summary.totalSpendAll,
                total_roas: dashboardData.summary.totalRoasAll
            };
        }
        if (!selectedDetails) return null;
        return {
            total_revenue: selectedDetails.totalRevenue,
            total_spend: selectedDetails.totalSpend,
            total_roas: selectedDetails.totalSpend > 0 ? selectedDetails.totalRevenue / selectedDetails.totalSpend : 0
        };
    }, [selectedKeys, selectedDetails, dashboardData]);

    const handleMainRowClick = (key: string, e: React.MouseEvent) => {
        const currentArray = sortedMainList;
        const itemKey = key;

        if (e.shiftKey && lastSelectedKey) {
            const lastIdx = currentArray.findIndex((i) => i.key === lastSelectedKey);
            const currIdx = currentArray.findIndex((i) => i.key === itemKey);
            const [start, end] = [Math.min(lastIdx, currIdx), Math.max(lastIdx, currIdx)];
            const newSet = new Set<string>();
            for (let i = start; i <= end; i++) newSet.add(currentArray[i].key);
            setSelectedKeys(newSet);
        } else if (e.ctrlKey || e.metaKey) {
            const newSet = new Set(selectedKeys);
            if (newSet.has(itemKey)) newSet.delete(itemKey);
            else newSet.add(itemKey);
            setSelectedKeys(newSet);
        } else {
            setSelectedKeys(new Set([itemKey]));
        }
        setLastSelectedKey(itemKey);
    };

    const qualityGroups = useMemo(() => {
        if (!dashboardData?.qualityData?.segments) return { estudios: {}, ingresos: {}, ocupacion: {}, edad_especifica: {} };
        const groups: Record<string, Record<string, { leads: number; sales: number; revenue: number; spend: number; profit: number }>> = {
            estudios: {},
            ingresos: {},
            ocupacion: {},
            edad_especifica: {}
        };
        for (const seg of dashboardData.qualityData.segments) {
            for (const [cat, key] of Object.entries({ estudios: seg.estudios, ingresos: seg.ingresos, ocupacion: seg.ocupacion, edad_especifica: seg.edad_especifica })) {
                const k = String(key || 'No Especificado');
                if (!groups[cat][k]) groups[cat][k] = { leads: 0, sales: 0, revenue: 0, spend: 0, profit: 0 };
                groups[cat][k].leads += seg.total_leads;
                groups[cat][k].sales += seg.total_sales;
                groups[cat][k].revenue += seg.total_revenue;
                groups[cat][k].spend += seg.total_spend;
                groups[cat][k].profit += seg.profit;
            }
        }
        return groups;
    }, [dashboardData?.qualityData]);

    const fieldNames: Record<string, string> = {
        qlead: 'Calidad Lead',
        ingresos: 'Nivel de Ingresos',
        estudios: 'Nivel de Estudios',
        ocupacion: 'Ocupación',
        proposito: 'Propósito',
        edad_especifica: 'Edad Específica'
    };

    if (!dashboardData) {
        return (
            <div className="min-h-screen bg-gray-100 p-6 font-sans">
                <div className="max-w-4xl mx-auto">
                    <header className="text-center mb-6">
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900">Dashboard Interactivo de ROAS</h1>
                        <p className="text-gray-600 mt-2">Analiza el rendimiento de tus campañas de forma visual e interactiva.</p>
                    </header>

                    <div className="bg-white rounded-xl shadow-lg p-6">
                        <h2 className="text-xl font-semibold mb-4 border-b pb-2">Configuración del Análisis</h2>
                        <form onSubmit={handleProcess} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">1. Tabla Base (Leads)</label>
                                    <select name="base_table" required className="block w-full px-3 py-2 border border-gray-300 rounded-md" value={baseTable} onChange={(e) => setBaseTable(e.target.value)}>
                                        <option value="">-- Selecciona --</option>
                                        {tables.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">2. Tabla de Ventas</label>
                                    <select name="sales_table" required className="block w-full px-3 py-2 border border-gray-300 rounded-md" value={salesTable} onChange={(e) => setSalesTable(e.target.value)}>
                                        <option value="">-- Selecciona --</option>
                                        {tables.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">3. Opciones</label>
                                <label className="flex items-center">
                                    <input type="checkbox" checked={multiplyRevenue} onChange={(e) => setMultiplyRevenue(e.target.checked)} className="h-4 w-4 text-indigo-600 rounded" />
                                    <span className="ml-2 text-sm">Multiplicar ingresos x2 (Coproducción)</span>
                                </label>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">4. Tasa de Cambio (opcional)</label>
                                <input type="number" step="0.01" placeholder="Ej: 1050" className="block w-full px-4 py-2 border border-gray-300 rounded-md" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">5. Reporte de Gastos (CSV)</label>
                                <input type="file" accept=".csv" required className="block w-full text-sm" onChange={(e) => setCsvFile(e.target.files?.[0] || null)} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">6. Reporte por País (CSV, opcional)</label>
                                <input type="file" accept=".csv" className="block w-full text-sm" onChange={(e) => setCountryCsvFile(e.target.files?.[0] || null)} />
                                <p className="text-xs text-gray-500 mt-1">Formato: Day, Amount Spent, Campaign Name, Leads, ..., Country</p>
                            </div>
                            <div className="flex justify-center">
                                <button type="submit" disabled={isLoading} className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : null} Analizar Datos
                                </button>
                            </div>
                            {error && <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    const qualityData = dashboardData.qualityData;
    const factorAnalysis = qualityData?.factor_analysis;

    return (
        <div className="min-h-screen bg-gray-100 p-6 font-sans">
            <div className="max-w-7xl mx-auto">
                <div className="mb-6 flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Dashboard Interactivo de ROAS</h1>
                        <p className="text-gray-600 mt-1">Proyecto en análisis</p>
                    </div>
                    <button onClick={() => setDashboardData(null)} className="bg-indigo-600 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-indigo-700">
                        Analizar Otro Proyecto
                    </button>
                </div>

                {/* Tabs */}
                <div className="mb-6 border-b border-gray-200">
                    <nav className="flex space-x-8 -mb-px">
                        <button
                            onClick={() => setActiveTab('general')}
                            className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'general' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        >
                            Análisis General
                        </button>
                        {qualityData && (
                            <button
                                onClick={() => setActiveTab('quality')}
                                className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'quality' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                            Análisis por Calidad de Leads
                            </button>
                        )}
                        {factorAnalysis && (
                            <button
                                onClick={() => setActiveTab('factors')}
                                className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'factors' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Análisis de Factores
                            </button>
                        )}
                        {dashboardData.countryData && (
                            <button
                                onClick={() => setActiveTab('countries')}
                                className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'countries' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Vista de Países
                            </button>
                        )}
                        {dashboardData.captationDaysData && dashboardData.captationDaysData.length > 0 && (
                            <button
                                onClick={() => setActiveTab('captation')}
                                className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'captation' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Días de Captación
                            </button>
                        )}
                    </nav>
                </div>

                {activeTab === 'general' && (
                    <div className="space-y-6">
                        <div className="bg-slate-50 border-l-4 border-slate-500 p-4 rounded-lg">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h3 className="font-semibold text-slate-800">Perspectiva de Análisis</h3>
                                    <p className="text-sm text-slate-600">Cambia cómo analizas tus datos</p>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <span className="text-sm">Anuncio → Segmentaciones</span>
                                    <input type="checkbox" checked={perspective === 'segments'} onChange={(e) => { setPerspective(e.target.checked ? 'segments' : 'ads'); setSelectedKeys(new Set()); }} className="rounded" />
                                    <span className="text-sm">Segmentación → Anuncios</span>
                                </label>
                            </div>
                        </div>

                        {summaryForSelection && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-4 rounded-lg shadow text-center">
                                    <h4 className="text-sm text-gray-500 uppercase">Ingresos {selectedKeys.size > 0 ? 'Seleccionados' : 'Totales'}</h4>
                                    <p className="text-2xl font-bold text-green-600">{formatCurrency(summaryForSelection.total_revenue)}</p>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow text-center">
                                    <h4 className="text-sm text-gray-500 uppercase">Gasto {selectedKeys.size > 0 ? 'Seleccionado' : 'Total'}</h4>
                                    <p className="text-2xl font-bold text-red-600">{formatCurrency(summaryForSelection.total_spend)}</p>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow text-center">
                                    <h4 className="text-sm text-gray-500 uppercase">ROAS</h4>
                                    <p className="text-2xl font-bold text-indigo-600">{summaryForSelection.total_roas.toFixed(2)}x</p>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col lg:flex-row gap-6">
                            <aside className="lg:w-1/3 bg-white rounded-lg shadow p-4">
                                <div className="flex justify-between items-center mb-3">
                                    <h2 className="font-bold">{perspective === 'ads' ? 'Análisis por Anuncio' : 'Análisis por Segmentación'}</h2>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setSelectedKeys(new Set(sortedMainList.map((i) => i.key)))} className="text-xs bg-gray-200 hover:bg-gray-300 py-1 px-2 rounded">Todos</button>
                                        <button type="button" onClick={() => setSelectedKeys(new Set())} className="text-xs bg-gray-200 hover:bg-gray-300 py-1 px-2 rounded">Ninguno</button>
                                    </div>
                                </div>
                                <div className="mb-2">
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Ordenar por:</label>
                                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="block w-full text-xs border rounded px-2 py-1">
                                        <option value="profit">Utilidad</option>
                                        <option value="revenue">Ingresos</option>
                                        <option value="spend">Gasto</option>
                                        <option value="roas">ROAS</option>
                                        <option value="name">Nombre</option>
                                    </select>
                                </div>
                                <div className="max-h-[60vh] overflow-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-gray-50 sticky top-0">
                                            <tr>
                                                <th className="px-2 py-2 text-left">{perspective === 'ads' ? 'Anuncio' : 'Segmentación'}</th>
                                                <th className="px-1 py-2 text-right">Ingresos</th>
                                                <th className="px-1 py-2 text-right">Gasto</th>
                                                <th className="px-1 py-2 text-right">Utilidad</th>
                                                <th className="px-1 py-2 text-right">ROAS</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedMainList.map((item) => (
                                                <tr
                                                    key={item.key}
                                                    onClick={(e) => handleMainRowClick(item.key, e)}
                                                    className={`cursor-pointer hover:bg-gray-50 ${selectedKeys.has(item.key) ? 'bg-indigo-50' : ''}`}
                                                >
                                                    <td className="px-2 py-2 font-medium truncate max-w-[120px]" title={item.name}>{item.name}</td>
                                                    <td className="px-1 py-2 text-right text-green-600">${formatCompact(item.total_revenue)}</td>
                                                    <td className="px-1 py-2 text-right text-red-600">${formatCompact(item.total_spend)}</td>
                                                    <td className={`px-1 py-2 text-right font-bold ${item.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>${formatCompact(item.profit)}</td>
                                                    <td className="px-1 py-2 text-right text-indigo-600">{item.roas.toFixed(1)}x</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </aside>

                            <main className="lg:w-2/3 bg-white rounded-lg shadow p-6">
                                {selectedKeys.size === 0 ? (
                                    <div className="text-center py-12 text-gray-500">
                                        <p className="text-xl font-semibold">Selecciona uno o más {perspective === 'ads' ? 'anuncios' : 'segmentaciones'}</p>
                                        <p className="mt-2">Los detalles aparecerán aquí.</p>
                                    </div>
                                ) : selectedDetails ? (
                                    <>
                                        <h2 className="text-xl font-bold mb-4">Resumen de la Selección ({selectedKeys.size} {perspective === 'ads' ? 'anuncios' : 'segmentaciones'})</h2>
                                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs text-gray-500 uppercase">Leads</h4>
                                                <p className="text-xl font-bold text-blue-600">{selectedDetails.totalLeads.toLocaleString()}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs text-gray-500 uppercase">Ventas</h4>
                                                <p className="text-xl font-bold text-purple-600">{selectedDetails.totalSales.toLocaleString()}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs text-gray-500 uppercase">Conv%</h4>
                                                <p className="text-xl font-bold">{selectedDetails.totalLeads > 0 ? ((selectedDetails.totalSales / selectedDetails.totalLeads) * 100).toFixed(2) : 0}%</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs text-gray-500 uppercase">Ingresos</h4>
                                                <p className="text-xl font-bold text-green-600">{formatCurrency(selectedDetails.totalRevenue)}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs text-gray-500 uppercase">Gasto</h4>
                                                <p className="text-xl font-bold text-red-600">{formatCurrency(selectedDetails.totalSpend)}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs text-gray-500 uppercase">Utilidad</h4>
                                                <p className={`text-xl font-bold ${selectedDetails.totalRevenue - selectedDetails.totalSpend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {formatCurrency(selectedDetails.totalRevenue - selectedDetails.totalSpend)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center mb-2">
                                            <h3 className="font-semibold">Análisis Combinado de {perspective === 'ads' ? 'Segmentaciones' : 'Anuncios'}</h3>
                                            <select value={detailSortBy} onChange={(e) => setDetailSortBy(e.target.value)} className="text-sm border rounded px-2 py-1">
                                                <option value="profit">Beneficio</option>
                                                <option value="revenue">Ingresos</option>
                                                <option value="leads">Leads</option>
                                                <option value="name">Nombre</option>
                                            </select>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left">Nombre</th>
                                                        <th className="px-4 py-2 text-right">Leads</th>
                                                        <th className="px-4 py-2 text-right">Ventas</th>
                                                        <th className="px-4 py-2 text-right">ROAS</th>
                                                        <th className="px-4 py-2 text-right">Ingresos</th>
                                                        <th className="px-4 py-2 text-right">Gasto</th>
                                                        <th className="px-4 py-2 text-right">Utilidad</th>
                                                        <th className="px-4 py-2 text-right">Conv%</th>
                                                        <th className="px-4 py-2 text-right">CPL</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedDetails.details.map((d: any, i: number) => {
                                                        const roas = (d.spend_allocated || 0) > 0 ? (d.revenue || 0) / (d.spend_allocated || 0) : 0;
                                                        return (
                                                            <tr key={i} className="border-t">
                                                                <td className="px-4 py-2 font-medium">{d.name}</td>
                                                                <td className="px-4 py-2 text-right">{d.leads?.toLocaleString()}</td>
                                                                <td className="px-4 py-2 text-right">{d.sales?.toLocaleString()}</td>
                                                                <td className={`px-4 py-2 text-right font-bold ${roas >= 2 ? 'text-green-600' : roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>{roas.toFixed(2)}x</td>
                                                                <td className="px-4 py-2 text-right text-green-600">{formatCurrency(d.revenue || 0)}</td>
                                                                <td className="px-4 py-2 text-right text-red-600">{formatCurrency(d.spend_allocated || 0)}</td>
                                                                <td className={`px-4 py-2 text-right font-bold ${(d.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(d.profit || 0)}</td>
                                                                <td className="px-4 py-2 text-right">{(d.conversion_rate || 0).toFixed(2)}%</td>
                                                                <td className="px-4 py-2 text-right">{formatCurrency(d.cpl || 0)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : null}
                            </main>
                        </div>
                    </div>
                )}

                {activeTab === 'quality' && qualityData && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-purple-50 to-pink-50">
                                <h4 className="text-sm font-medium text-purple-700">Segmentos de Calidad</h4>
                                <p className="text-2xl font-bold text-purple-600">{qualityData.segments?.length || 0}</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-green-50 to-blue-50">
                                <h4 className="text-sm font-medium text-green-700">Ingresos Totales</h4>
                                <p className="text-2xl font-bold text-green-600">{formatCurrency(qualityData.summary?.total_revenue || 0)}</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-yellow-50 to-orange-50">
                                <h4 className="text-sm font-medium text-yellow-700">ROAS Promedio</h4>
                                <p className="text-2xl font-bold text-yellow-600">{(qualityData.summary?.total_roas || 0).toFixed(2)}x</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-indigo-50 to-purple-50">
                                <h4 className="text-sm font-medium text-indigo-700">Gasto Total</h4>
                                <p className="text-2xl font-bold text-indigo-600">{formatCurrency(qualityData.summary?.total_spend || 0)}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {(['estudios', 'ingresos', 'ocupacion', 'edad_especifica'] as const).map((cat) => {
                                const groups = qualityGroups[cat] || {};
                                const rows = Object.entries(groups).map(([name, data]) => {
                                    const conv = data.leads > 0 ? (data.sales / data.leads) * 100 : 0;
                                    const roas = data.spend > 0 ? data.revenue / data.spend : 0;
                                    return { name, ...data, conv, roas };
                                });
                                const labels: Record<string, string> = { estudios: 'Estudios', ingresos: 'Ingresos', ocupacion: 'Ocupación', edad_especifica: 'Edad' };
                                return (
                                    <div key={cat} className="bg-white rounded-lg shadow p-4">
                                        <h4 className="font-semibold mb-3 text-indigo-700">Por {labels[cat]}</h4>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-3 py-2 text-left">{labels[cat]}</th>
                                                        <th className="px-3 py-2 text-center">Leads</th>
                                                        <th className="px-3 py-2 text-center">Gasto</th>
                                                        <th className="px-3 py-2 text-center">Conv%</th>
                                                        <th className="px-3 py-2 text-center">ROAS</th>
                                                        <th className="px-3 py-2 text-center">Profit</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rows.map((r) => (
                                                        <tr key={r.name} className="border-t hover:bg-gray-50">
                                                            <td className="px-3 py-2 font-medium">{r.name}</td>
                                                            <td className="px-3 py-2 text-center text-blue-600">{r.leads.toLocaleString()}</td>
                                                            <td className="px-3 py-2 text-center text-purple-600">{formatCurrency(r.spend)}</td>
                                                            <td className={`px-3 py-2 text-center ${r.conv >= 5 ? 'text-green-600' : r.conv >= 2 ? 'text-yellow-600' : 'text-red-600'}`}>{r.conv.toFixed(1)}%</td>
                                                            <td className={`px-3 py-2 text-center ${r.roas >= 2 ? 'text-green-600' : r.roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>{r.roas.toFixed(1)}x</td>
                                                            <td className={`px-3 py-2 text-center ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(r.profit)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeTab === 'factors' && factorAnalysis && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                <div className="text-2xl font-bold text-green-600">{factorAnalysis.stats.high_roas_count}</div>
                                <div className="text-sm text-green-700">Segmentos ROAS ≥ 1.5x</div>
                                <div className="text-xs text-green-600">ROAS Prom: {factorAnalysis.stats.avg_roas_good}x</div>
                            </div>
                            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                <div className="text-2xl font-bold text-red-600">{factorAnalysis.stats.low_roas_count}</div>
                                <div className="text-sm text-red-700">Segmentos ROAS &lt; 1.5x</div>
                                <div className="text-xs text-red-600">ROAS Prom: {factorAnalysis.stats.avg_roas_bad}x</div>
                            </div>
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                                <div className="text-2xl font-bold text-blue-600">{factorAnalysis.stats.total_segments}</div>
                                <div className="text-sm text-blue-700">Total Segmentos</div>
                            </div>
                            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                                <div className="text-2xl font-bold text-purple-600">
                                    {factorAnalysis.stats.total_segments > 0 ? ((factorAnalysis.stats.high_roas_count / factorAnalysis.stats.total_segments) * 100).toFixed(1) : 0}%
                                </div>
                                <div className="text-sm text-purple-700">% Éxito</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                                <h4 className="text-lg font-semibold text-green-800 mb-4">Factores que Generan ROAS Alto (≥1.5x)</h4>
                                {(['qlead', 'ingresos', 'estudios', 'ocupacion', 'proposito', 'edad_especifica'] as const).map((field) => {
                                    const items = factorAnalysis.good_factors?.[field];
                                    if (!items || Object.keys(items).length === 0) return null;
                                    return (
                                        <div key={field} className="mb-4">
                                            <h5 className="font-medium text-green-700 mb-2">{fieldNames[field]}</h5>
                                            <div className="space-y-2">
                                                {Object.entries(items).map(([value, stats]: [string, any]) => (
                                                    <div key={value} className="bg-white p-3 rounded text-sm border">
                                                        <div className="flex justify-between">
                                                            <span className="font-medium">{value}</span>
                                                            <span className="text-green-600 font-semibold">{stats.ratio}%</span>
                                                        </div>
                                                        <div className="text-xs text-gray-600">
                                                            {stats.good_leads} leads exitosos de {stats.total_leads} total
                                                            {stats.avg_roas_good > 0 && ` • ROAS prom: ${stats.avg_roas_good}x`}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {factorAnalysis.good_factors?.combinations && Object.keys(factorAnalysis.good_factors.combinations).length > 0 && (
                                    <div className="mt-4">
                                        <h5 className="font-medium text-green-700 mb-2">Combinaciones Exitosas</h5>
                                        {Object.entries(factorAnalysis.good_factors.combinations).map(([combo, stats]: [string, any]) => (
                                            <div key={combo} className="bg-white p-3 rounded text-sm border mb-2">
                                                <div className="flex justify-between">
                                                    <span className="font-medium">{combo}</span>
                                                    <span className="text-green-600 font-semibold">{stats.ratio}%</span>
                                                </div>
                                                <div className="text-xs text-gray-600">{stats.good_leads} leads exitosos de {stats.total_leads} total</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="bg-red-50 p-6 rounded-lg border border-red-200">
                                <h4 className="text-lg font-semibold text-red-800 mb-4">Factores que Generan ROAS Bajo (&lt;1.5x)</h4>
                                {(['qlead', 'ingresos', 'estudios', 'ocupacion', 'proposito', 'edad_especifica'] as const).map((field) => {
                                    const items = factorAnalysis.bad_factors?.[field];
                                    if (!items || Object.keys(items).length === 0) return null;
                                    return (
                                        <div key={field} className="mb-4">
                                            <h5 className="font-medium text-red-700 mb-2">{fieldNames[field]}</h5>
                                            <div className="space-y-2">
                                                {Object.entries(items).map(([value, stats]: [string, any]) => (
                                                    <div key={value} className="bg-white p-3 rounded text-sm border">
                                                        <div className="flex justify-between">
                                                            <span className="font-medium">{value}</span>
                                                            <span className="text-red-600 font-semibold">{stats.ratio}%</span>
                                                        </div>
                                                        <div className="text-xs text-gray-600">
                                                            {stats.good_leads} leads exitosos de {stats.total_leads} total
                                                            {stats.avg_roas_bad > 0 && ` • ROAS prom: ${stats.avg_roas_bad}x`}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {factorAnalysis.bad_factors?.combinations && Object.keys(factorAnalysis.bad_factors.combinations).length > 0 && (
                                    <div className="mt-4">
                                        <h5 className="font-medium text-red-700 mb-2">Combinaciones Problemáticas</h5>
                                        {Object.entries(factorAnalysis.bad_factors.combinations).map(([combo, stats]: [string, any]) => (
                                            <div key={combo} className="bg-white p-3 rounded text-sm border mb-2">
                                                <div className="flex justify-between">
                                                    <span className="font-medium">{combo}</span>
                                                    <span className="text-red-600 font-semibold">{stats.ratio}%</span>
                                                </div>
                                                <div className="text-xs text-gray-600">{stats.good_leads} leads exitosos de {stats.total_leads} total</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                            <h5 className="font-semibold text-blue-800 mb-4">Recomendaciones de Acción</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h6 className="font-medium text-blue-700 mb-2">Para Optimizar:</h6>
                                    <ul className="text-sm text-blue-700 space-y-1">
                                        <li>• Enfócate en los factores positivos identificados</li>
                                        <li>• Incrementa gasto en segmentos con factores exitosos</li>
                                        <li>• Crea audiencias basadas en combinaciones exitosas</li>
                                    </ul>
                                </div>
                                <div>
                                    <h6 className="font-medium text-blue-700 mb-2">Para Evitar:</h6>
                                    <ul className="text-sm text-blue-700 space-y-1">
                                        <li>• Reduce inversión en factores problemáticos</li>
                                        <li>• Excluye audiencias con combinaciones negativas</li>
                                        <li>• Ajusta creativos para atraer perfiles exitosos</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'captation' && dashboardData.captationDaysData && dashboardData.captationDaysData.length > 0 && (
                    <div className="space-y-6">
                        <div className="bg-white rounded-lg shadow p-6">
                            <h3 className="text-lg font-semibold mb-2 text-indigo-800">Compras vs Días desde Registro</h3>
                            <p className="text-sm text-gray-600 mb-6">
                                Distribución de ventas según cuántos días pasaron entre el registro del lead y la compra. Útil para decidir si ampliar o reducir la ventana de captación.
                            </p>
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={dashboardData.captationDaysData.map((r: any) => ({ ...r, dia: `Día ${r.days}` }))} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="dia" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                                        <YAxis tick={{ fontSize: 11 }} label={{ value: 'Compras', angle: -90, position: 'insideLeft' }} />
                                        <Tooltip content={({ active, payload, label }) => {
                                            if (!active || !payload?.length) return null;
                                            const d = payload[0]?.payload;
                                            return (
                                                <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-sm">
                                                    <p className="font-semibold mb-2">{label}</p>
                                                    <p>Compras: <strong>{d?.count ?? 0}</strong></p>
                                                    <p>Ingresos: <strong>{formatCurrency(d?.revenue ?? 0)}</strong></p>
                                                </div>
                                            );
                                        }} />
                                        <Legend />
                                        <Bar dataKey="count" name="Compras" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            {(() => {
                                const data = dashboardData.captationDaysData as { days: number; count: number; revenue: number }[];
                                const totalCount = data.reduce((s, r) => s + r.count, 0);
                                const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
                                const by7 = data.filter((r) => r.days <= 7).reduce((s, r) => ({ count: s.count + r.count, revenue: s.revenue + r.revenue }), { count: 0, revenue: 0 });
                                const by14 = data.filter((r) => r.days <= 14).reduce((s, r) => ({ count: s.count + r.count, revenue: s.revenue + r.revenue }), { count: 0, revenue: 0 });
                                const by30 = data.filter((r) => r.days <= 30).reduce((s, r) => ({ count: s.count + r.count, revenue: s.revenue + r.revenue }), { count: 0, revenue: 0 });
                                return (
                                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
                                        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                            <p className="text-xs font-medium text-indigo-700 uppercase">Primeros 7 días</p>
                                            <p className="text-xl font-bold text-indigo-600">{by7.count} compras</p>
                                            <p className="text-sm text-indigo-600">{formatCurrency(by7.revenue)}</p>
                                            <p className="text-xs text-gray-500">{totalCount > 0 ? ((by7.count / totalCount) * 100).toFixed(1) : 0}% del total</p>
                                        </div>
                                        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                            <p className="text-xs font-medium text-indigo-700 uppercase">Primeros 14 días</p>
                                            <p className="text-xl font-bold text-indigo-600">{by14.count} compras</p>
                                            <p className="text-sm text-indigo-600">{formatCurrency(by14.revenue)}</p>
                                            <p className="text-xs text-gray-500">{totalCount > 0 ? ((by14.count / totalCount) * 100).toFixed(1) : 0}% del total</p>
                                        </div>
                                        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                            <p className="text-xs font-medium text-indigo-700 uppercase">Primeros 30 días</p>
                                            <p className="text-xl font-bold text-indigo-600">{by30.count} compras</p>
                                            <p className="text-sm text-indigo-600">{formatCurrency(by30.revenue)}</p>
                                            <p className="text-xs text-gray-500">{totalCount > 0 ? ((by30.count / totalCount) * 100).toFixed(1) : 0}% del total</p>
                                        </div>
                                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                            <p className="text-xs font-medium text-gray-700 uppercase">Total</p>
                                            <p className="text-xl font-bold text-gray-800">{totalCount} compras</p>
                                            <p className="text-sm text-gray-700">{formatCurrency(totalRevenue)}</p>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {activeTab === 'countries' && dashboardData.countryData && (
                    <div className="space-y-6">
                        <div className="bg-white rounded-lg shadow overflow-hidden">
                            <h3 className="text-lg font-semibold p-4 border-b bg-indigo-50 text-indigo-800">Vista de Países</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-medium text-gray-700">País</th>
                                            <th className="px-4 py-3 text-right font-medium text-gray-700">Gasto</th>
                                            <th className="px-4 py-3 text-right font-medium text-gray-700">ROAS</th>
                                            <th className="px-4 py-3 text-right font-medium text-gray-700">Ventas Orgánicas</th>
                                            <th className="px-4 py-3 text-right font-medium text-gray-700">Ventas Trackeadas</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {dashboardData.countryData.map((row: any) => (
                                            <tr key={row.country} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 font-medium">{row.country}</td>
                                                <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.gasto)}</td>
                                                <td className={`px-4 py-3 text-right font-bold ${row.roas >= 2 ? 'text-green-600' : row.roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                    {row.roas.toFixed(2)}x
                                                </td>
                                                <td className="px-4 py-3 text-right text-green-600">{formatCurrency(row.ventas_organicas)}</td>
                                                <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(row.ventas_trackeadas)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
