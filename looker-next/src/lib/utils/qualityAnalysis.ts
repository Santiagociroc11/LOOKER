import { normalizeAdName, cleanDisplayName, SpendSegmentation } from './csvProcessor';

export interface QualitySegment {
    qlead: string;
    ingresos: string;
    estudios: string;
    ocupacion: string;
    proposito: string;
    edad_especifica: string;
    avg_puntaje: number;
    total_leads: number;
    total_sales: number;
    total_revenue: number;
    total_spend: number;
    roas: number;
    conversion_rate: number;
    profit: number;
    cpl: number;
    ads: Record<string, {
        ad_name: string;
        segmentation: string;
        campaign: string;
        ad_id: string;
        leads: number;
        sales: number;
        revenue: number;
        spend: number;
        puntaje_sum: number;
        puntaje_count: number;
    }>;
}

export function buildQualityAnalysis(
    qualityLeadData: any[],
    segmentationsData: Record<string, SpendSegmentation>,
    multiplyRevenue: boolean
): { summary: any; segments: QualitySegment[]; factor_analysis: any } | null {
    if (!qualityLeadData || qualityLeadData.length === 0) return null;

    const qualitySegments: Record<string, QualitySegment> = {};
    let totalRevenueAll = 0;
    let totalSpendAll = 0;

    const segValues = Object.values(segmentationsData);

    for (const row of qualityLeadData) {
        const qlead = row.QLEAD && String(row.QLEAD).trim() ? row.QLEAD : 'Sin Clasificar';
        const ingresos = row.INGRESOS && String(row.INGRESOS).trim() ? row.INGRESOS : 'No Especificado';
        const estudios = row.ESTUDIOS && String(row.ESTUDIOS).trim() ? row.ESTUDIOS : 'No Especificado';
        const ocupacion = row.OCUPACION && String(row.OCUPACION).trim() ? row.OCUPACION : 'No Especificado';
        const proposito = row.PROPOSITO && String(row.PROPOSITO).trim() ? row.PROPOSITO : 'No Especificado';
        const edadEspecifica = row.EDAD_ESPECIFICA && String(row.EDAD_ESPECIFICA).trim() ? row.EDAD_ESPECIFICA : 'No Especificado';
        const puntaje = row.PUNTAJE ? parseFloat(row.PUNTAJE) : 0;

        const adNameNormalized = row.ANUNCIO_NORMALIZED;
        const segmentationNormalized = row.SEGMENTACION_NORMALIZED;
        const revenue = parseFloat(row.total_revenue) || 0;
        const leads = parseInt(row.total_leads, 10) || 0;
        const sales = parseInt(row.total_sales, 10) || 0;

        const qualityKey = `${qlead}|${ingresos}|${estudios}|${ocupacion}|${edadEspecifica}`;

        if (!qualitySegments[qualityKey]) {
            qualitySegments[qualityKey] = {
                qlead,
                ingresos,
                estudios,
                ocupacion,
                proposito,
                edad_especifica: edadEspecifica,
                avg_puntaje: 0,
                total_leads: 0,
                total_sales: 0,
                total_revenue: 0,
                total_spend: 0,
                roas: 0,
                conversion_rate: 0,
                profit: 0,
                cpl: 0,
                ads: {}
            };
        }

        const seg = qualitySegments[qualityKey];
        seg.total_leads += leads;
        seg.total_sales += sales;
        seg.total_revenue += revenue;

        const adKey = `${adNameNormalized}|${segmentationNormalized}`;
        if (!seg.ads[adKey]) {
            seg.ads[adKey] = {
                ad_name: cleanDisplayName(row.ANUNCIO),
                segmentation: cleanDisplayName(row.SEGMENTACION),
                campaign: row.CAMPAÑA || '',
                ad_id: row.AD_ID || '',
                leads: 0,
                sales: 0,
                revenue: 0,
                spend: 0,
                puntaje_sum: 0,
                puntaje_count: 0
            };
        }
        seg.ads[adKey].leads += leads;
        seg.ads[adKey].sales += sales;
        seg.ads[adKey].revenue += revenue;
        seg.ads[adKey].puntaje_sum += puntaje * leads;
        seg.ads[adKey].puntaje_count += leads;
    }

    for (const segData of segValues) {
        const adKey = `${segData.ad_name_normalized}|${normalizeAdName(segData.segmentation_name)}`;
        const spend = segData.spend;

        let totalLeadsForAd = 0;
        for (const qualitySeg of Object.values(qualitySegments)) {
            if (qualitySeg.ads[adKey]) {
                totalLeadsForAd += qualitySeg.ads[adKey].leads;
            }
        }

        for (const qualitySeg of Object.values(qualitySegments)) {
            if (qualitySeg.ads[adKey] && totalLeadsForAd > 0) {
                const proportion = qualitySeg.ads[adKey].leads / totalLeadsForAd;
                const proportionalSpend = spend * proportion;
                qualitySeg.ads[adKey].spend = proportionalSpend;
                qualitySeg.total_spend += proportionalSpend;
                totalSpendAll += proportionalSpend;
            }
        }
    }

    const segmentsArray: QualitySegment[] = [];
    for (const seg of Object.values(qualitySegments)) {
        seg.conversion_rate = seg.total_leads > 0 ? (seg.total_sales / seg.total_leads) * 100 : 0;
        seg.roas = seg.total_spend > 0 ? seg.total_revenue / seg.total_spend : 0;
        seg.profit = seg.total_revenue - seg.total_spend;
        seg.cpl = seg.total_leads > 0 && seg.total_spend > 0 ? seg.total_spend / seg.total_leads : 0;

        let totalPuntajeSum = 0;
        let totalPuntajeCount = 0;
        for (const ad of Object.values(seg.ads)) {
            if (ad.puntaje_count > 0) {
                totalPuntajeSum += ad.puntaje_sum;
                totalPuntajeCount += ad.puntaje_count;
            }
        }
        seg.avg_puntaje = totalPuntajeCount > 0 ? totalPuntajeSum / totalPuntajeCount : 0;
        totalRevenueAll += seg.total_revenue;

        segmentsArray.push(seg);
    }

    segmentsArray.sort((a, b) => b.roas - a.roas);

    const totalRoasAll = totalSpendAll > 0 ? totalRevenueAll / totalSpendAll : 0;
    const factorAnalysis = analyzeFactors(segmentsArray, 1.5);

    return {
        summary: {
            total_revenue: totalRevenueAll,
            total_spend: totalSpendAll,
            total_roas: totalRoasAll,
            multiply_revenue: multiplyRevenue
        },
        segments: segmentsArray,
        factor_analysis: factorAnalysis
    };
}

export function analyzeFactors(qualitySegments: QualitySegment[], roasThreshold = 1.5) {
    const factorAnalysis: any = {
        good_factors: {
            qlead: {} as Record<string, any>,
            ingresos: {} as Record<string, any>,
            estudios: {} as Record<string, any>,
            ocupacion: {} as Record<string, any>,
            proposito: {} as Record<string, any>,
            edad_especifica: {} as Record<string, any>,
            combinations: {} as Record<string, any>
        },
        bad_factors: {
            qlead: {} as Record<string, any>,
            ingresos: {} as Record<string, any>,
            estudios: {} as Record<string, any>,
            ocupacion: {} as Record<string, any>,
            proposito: {} as Record<string, any>,
            edad_especifica: {} as Record<string, any>,
            combinations: {} as Record<string, any>
        },
        stats: {
            total_segments: 0,
            high_roas_count: 0,
            low_roas_count: 0,
            avg_roas_good: 0,
            avg_roas_bad: 0
        }
    };

    const goodRoasSegments = qualitySegments.filter(s => s.roas >= roasThreshold);
    const badRoasSegments = qualitySegments.filter(s => s.roas < roasThreshold);

    factorAnalysis.stats.total_segments = qualitySegments.length;
    factorAnalysis.stats.high_roas_count = goodRoasSegments.length;
    factorAnalysis.stats.low_roas_count = badRoasSegments.length;

    const factorFields = ['qlead', 'ingresos', 'estudios', 'ocupacion', 'proposito', 'edad_especifica'];

    for (const field of factorFields) {
        const goodCounts: Record<string, number> = {};
        const badCounts: Record<string, number> = {};

        for (const segment of goodRoasSegments) {
            const value = (segment as any)[field] ?? 'Sin Clasificar';
            goodCounts[value] = (goodCounts[value] ?? 0) + segment.total_leads;
        }
        for (const segment of badRoasSegments) {
            const value = (segment as any)[field] ?? 'Sin Clasificar';
            badCounts[value] = (badCounts[value] ?? 0) + segment.total_leads;
        }

        const allValues = new Set([...Object.keys(goodCounts), ...Object.keys(badCounts)]);

        for (const value of allValues) {
            const goodCount = goodCounts[value] ?? 0;
            const badCount = badCounts[value] ?? 0;
            const totalCount = goodCount + badCount;

            if (totalCount >= 5) {
                const ratio = goodCount / totalCount;

                let goodRoasSum = 0, goodSegmentsCount = 0;
                let badRoasSum = 0, badSegmentsCount = 0;
                for (const seg of goodRoasSegments) {
                    if (((seg as any)[field] ?? 'Sin Clasificar') === value) {
                        goodRoasSum += seg.roas;
                        goodSegmentsCount++;
                    }
                }
                for (const seg of badRoasSegments) {
                    if (((seg as any)[field] ?? 'Sin Clasificar') === value) {
                        badRoasSum += seg.roas;
                        badSegmentsCount++;
                    }
                }

                const stats = {
                    good_leads: goodCount,
                    bad_leads: badCount,
                    ratio: Math.round(ratio * 1000) / 10,
                    total_leads: totalCount,
                    avg_roas_good: goodSegmentsCount > 0 ? Math.round((goodRoasSum / goodSegmentsCount) * 100) / 100 : 0,
                    avg_roas_bad: badSegmentsCount > 0 ? Math.round((badRoasSum / badSegmentsCount) * 100) / 100 : 0
                };

                if (ratio >= 0.7) {
                    factorAnalysis.good_factors[field][value] = stats;
                } else if (ratio <= 0.3) {
                    factorAnalysis.bad_factors[field][value] = stats;
                }
            }
        }
    }

    const factorPairs = [
        ['qlead', 'ingresos'],
        ['qlead', 'ocupacion'],
        ['qlead', 'edad_especifica'],
        ['ingresos', 'estudios'],
        ['ingresos', 'ocupacion'],
        ['ingresos', 'edad_especifica'],
        ['estudios', 'ocupacion'],
        ['edad_especifica', 'ocupacion']
    ];

    for (const pair of factorPairs) {
        const goodComboCounts: Record<string, number> = {};
        const badComboCounts: Record<string, number> = {};

        for (const segment of goodRoasSegments) {
            const v1 = (segment as any)[pair[0]] ?? 'Sin Clasificar';
            const v2 = (segment as any)[pair[1]] ?? 'Sin Clasificar';
            const combo = `${v1} + ${v2}`;
            goodComboCounts[combo] = (goodComboCounts[combo] ?? 0) + segment.total_leads;
        }
        for (const segment of badRoasSegments) {
            const v1 = (segment as any)[pair[0]] ?? 'Sin Clasificar';
            const v2 = (segment as any)[pair[1]] ?? 'Sin Clasificar';
            const combo = `${v1} + ${v2}`;
            badComboCounts[combo] = (badComboCounts[combo] ?? 0) + segment.total_leads;
        }

        const allCombos = new Set([...Object.keys(goodComboCounts), ...Object.keys(badComboCounts)]);

        for (const combo of allCombos) {
            const goodCount = goodComboCounts[combo] ?? 0;
            const badCount = badComboCounts[combo] ?? 0;
            const totalCount = goodCount + badCount;

            if (totalCount >= 10) {
                const ratio = goodCount / totalCount;
                const stats = {
                    good_leads: goodCount,
                    bad_leads: badCount,
                    ratio: Math.round(ratio * 1000) / 10,
                    total_leads: totalCount,
                    factors: pair
                };

                if (ratio >= 0.8) {
                    factorAnalysis.good_factors.combinations[combo] = stats;
                } else if (ratio <= 0.2) {
                    factorAnalysis.bad_factors.combinations[combo] = stats;
                }
            }
        }
    }

    if (goodRoasSegments.length > 0) {
        factorAnalysis.stats.avg_roas_good = Math.round(
            (goodRoasSegments.reduce((s, seg) => s + seg.roas, 0) / goodRoasSegments.length) * 100
        ) / 100;
    }
    if (badRoasSegments.length > 0) {
        factorAnalysis.stats.avg_roas_bad = Math.round(
            (badRoasSegments.reduce((s, seg) => s + seg.roas, 0) / badRoasSegments.length) * 100
        ) / 100;
    }

    return factorAnalysis;
}
