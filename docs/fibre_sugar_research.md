# CALIBEX food table: fibre and sugar research (2026-10-21)

**Sources used.** IFCT 2017 (NIN) via the mirror https://github.com/ifct2017/compositions (compositions/index.csv): the fibre and sugar columns of the proximates and "starch and sugars" tables. USDA FoodData Central API (https://api.nal.usda.gov/fdc/v1/food/<id>). Not used: the NIN PDF, INDB.xlsx (binary, unreadable here).

**Verified IFCT values (per 100 g raw, TDF / free sugars / available carb).**
- Cereals: A011 3.46/0.34/76.75 · A013 4.43/0.69/74.8 · A015 2.81/0.69/78.24 · A018 2.76/1.79/74.27 · A019 11.36/1.80/64.17 · A022 9.72/1.65/68.43 · A023 9.28/1.68/70.39
- Pulses: B001 15.15/1.03/46.72 · B002 25.22/0.99/39.56 · B003 11.93/0.84/51.0 · B004 20.41/0.45/43.99 · B005 11.54/1.60/54.62 · B010 9.37/0.95/52.59 · B011 17.04/0.54/46.13 · B020 16.57/1.52/48.61 · B021 9.06/2.08/55.23
- Vegetables: C033 2.38/0.24/2.05 · C015 2.76/1.00/3.25 · D001 3.37/0.19/2.84 · D031 3.98/0.97/3.52 · D033 2.06/0.86/1.84 · D036 3.71/0.47/2.03 · D043 2.14/0.27/3.48 · D056 4.08/0.48/3.62 · D061 6.32/0.97/11.88 · D065 2.53/2.90/4.22 · D075 1.58/1.82/3.20 · D076 1.77/1.34/2.71 · F002 4.18/3.23/5.55 · F006 1.71/0.32/14.89 · F015 4.61/2.14/17.81 · G017 2.45/5.88/9.56
- Fruit: E002 2.54/8.39/10.65 · E012 1.94/13.65/23.63 · E017 8.95/66.63/74.91
- Nuts and seeds: H001 13.06/2.23/3.04 · H005 3.86/3.11/25.46 · H007 10.42/6.20/6.30 · H012 10.38/4.42/17.27
- Dairy and drinks: L002 0/4.89/4.94 · L003 0/11.57/12.41 · L004 0/16.14/16.53 (protein 16.34, fat 20.62) · K002 0/3.06/3.16

**USDA values used.**
- 171284 yogurt: 0 / 4.66
- 172469 peanut butter: 8.0 / 8.41
- 170567 almonds: 12.5 / 4.35
- 171688 apple: 2.4 / 10.39
- 173904 oats: 10.1 / 0.99
- 171477 chicken breast: 0 / 0
- 168191 medjool dates: 6.7 / 66.5
- 174924 white bread: 2.7 / 5.67
- 172688 whole-wheat bread: 6.0 / 4.34

**Method.**
- Single-ingredient rows use the row's own factor, `row.carb_100 / ingredient carb`, applied to fibre and sugar.
- Mixed rows are back-solved from the row's carb and protein, and the amounts are marked "assumed".
- Leftover carb from unspecified onion/tomato masala gets fibre 0.4 and sugar 0.5 per g of carb. Both are below the onion/tomato mix (0.45 and 0.55).
- Leftover carb from unspecified mixed vegetables gets fibre 0.5 and sugar 0.4 per g of carb.
- Values are rounded to 0.1. Where an ingredient's contribution couldn't be confirmed (mozzarella and cream lactose, bun and sauce added sugar, tamarind), it is left out, so those rows err low.
- Every row was checked against sugar ≤ carb and fibre + protein + carb + fat ≤ 100.

| key | fibre_100 | sugar_100 | source / derivation |
|---|---|---|---|
| roti | 8.6 | 1.4 | A019 × (48.4/64.17 = 0.754) |
| ghee_roti | 8.0 | 1.3 | A019 × (45.1/64.17); ghee adds none |
| paratha | 7.8 | 1.2 | A019 × (44.2/64.17 = 0.689) |
| aloo_paratha | 5.0 | 0.8 | A019 40 g + F006 50 g; total mass 108 g back-solved from carb 30.6; oil adds none |
| porotta | 1.5 | 3.3 | A018 at 55 g (protein-solved) = 1.5 fibre + 1.0 sugar; the remaining 2.3 g carb is the added sugar. 40% moisture assumed |
| bhatura | 1.6 | 1.3 | A018 0.59 (solved from carb and protein) + curd ~4.7 g (USDA 4.66); assumed |
| puri | 7.6 | 1.2 | A019 × (42.8/64.17) |
| dosa | 2.6 | 0.4 | A015 37.6 g + B003 12.5 g per 100 g (carb-solved, 3:1) |
| masala_dosa | 2.1 | 0.3 | Dosa share 0.48 + potato-only filling (F006 ratios); onion left out; assumed |
| idli | 2.0 | 0.3 | A015 23.2 g + B003 11.6 g (carb-solved, 2:1) |
| vada | 6.3 | 0.4 | B003 × (26.9/51) |
| appam | 1.9 | 0.7 | A015 39.5 g + H007 7.5 g (carb and fat solved); assumed |
| puttu | 2.4 | 1.0 | A015 41.2 g + H007 12 g (carb and fat solved); assumed |
| upma | 2.4 | 0.4 | A022 × (17.1/68.43 = 0.25) |
| poha | 1.3 | 0.1 | A011 × (29.2/76.75 = 0.38) |
| rice | 0.9 | 0.2 | A015 ÷ 2.98 |
| matta_rice | 1.7 | 0.3 | A013 ÷ 2.60 |
| jeera_rice | 0.9 | 0.2 | A015 × 0.33; ghee adds none |
| veg_biryani | 1.2 | 0.5 | Rice ~22 g raw + ~20 g mixed vegetables; recipe assumed |
| chicken_biryani | 0.8 | 0.5 | Rice ~20 g raw + ~10 g onion/tomato; chicken adds none; assumed |
| dal | 1.8 | 0.4 | B021 × 0.2 |
| dal_tadka | 1.7 | 0.4 | B021 × (10.5/55.23); ghee adds none |
| sambar | 1.3 | 0.6 | B021 8 g + vegetables for the leftover 1.2 g carb; assumed (tamarind sugar ignored) |
| rasam | 0.6 | 0.4 | B021 2 g + ~28 g tomato (D075 fibre, D076 sugar); assumed |
| rajma | 3.7 | 0.8 | B020 20 g + ~8 g onion + ~15 g tomato; assumed |
| chole | 5.4 | 0.7 | B002 20 g + ~7 g onion + ~12 g tomato; assumed |
| sabzi | 2.5 | 1.2 | Mixed vegetables carry carb 6.2 (fibre 0.4, sugar 0.2 per g carb); assumed |
| thoran | 3.0 | 1.3 | H007 8 g (0.83 fibre, 0.50 sugar) + cabbage-type vegetables C015; assumed |
| aloo_sabzi | 1.7 | 0.9 | F006 ~85 g + G017 ~22 g, solved from carb and protein; assumed |
| palak_paneer | 1.5 | 3.4 | C033 50 g + L003 25 g (sugar 11.57) + masala for the leftover carb; paneer drives the sugar |
| paneer_butter_masala | 0.8 | 3.9 | L003 25 g + cashew 3 g + tomato/onion masala; no cream sugar counted; assumed |
| curd | 0 | 4.7 | USDA 171284 (4.66) |
| raita | 0.5 | 3.6 | 0.75 × curd + 0.25 × D043 |
| boiled_egg | 0 | 0 | IFCT M004; carb 0 |
| omelette | 0 | 0 | IFCT M007; carb 0 |
| egg_curry | 1.2 | 1.5 | Egg adds none; gravy carb 3.0 as onion/tomato masala; assumed |
| chicken_curry | 1.0 | 1.2 | N003 adds none; masala carb 2.5; assumed |
| fish_curry | 1.0 | 0.9 | H007 ~5.8 g (fat-solved) + masala; P034 adds none; assumed |
| fish_fry | 0 | 0 | IFCT P034; carb 0 |
| beef_fry | 1.5 | 1.2 | H007 ~10 g + onion/tomato masala; O027 adds none; assumed |
| chai | 0 | 3.7 | 25 g milk (4.89 lactose) + 2.5 g sugar per 100 g |
| filter_coffee | 0 | 6.2 | 60 g milk + 3.33 g sugar per 100 g = 6.26, rounded down to stay ≤ carb 6.3 |
| milk | 0 | 4.9 | IFCT L002 (4.89) |
| toned_milk | 0 | 4.6 | Lactose ≈ carb 4.7 × the L002 ratio (0.99); assumed |
| banana | 1.9 | 13.6 | IFCT E012 (13.65, rounded down) |
| idiyappam | 1.3 | 0.3 | A015 ÷ 2.2 |
| pathiri | 1.8 | 0.4 | A015 ÷ 1.6 |
| avial | 2.4 | 1.8 | H007 10 g + curd 10 g + vegetables at fibre 0.3 and sugar 0.15 per g carb; recipe assumed |
| olan | 1.8 | 0.6 | Cowpea B005 ~5 g + ash gourd ~35 g (D001) + coconut milk as sugar only; assumed |
| erissery | 3.2 | 1.8 | H007 ~11 g + B005 ~11 g + pumpkin ~36 g (D065); assumed |
| moru_curry | 1.2 | 1.5 | Curd 25 g + H007 6 g + ash gourd 20 g; assumed |
| kootu | 2.0 | 0.9 | B010 ~8 g + H007 ~5 g + vegetables; assumed |
| uttapam | 2.5 | 0.8 | A015 31 g + B003 10 g (carb-solved) + topping carb ~1.3; assumed |
| rava_dosa | 3.0 | 0.8 | A022 = A015 = A018 at 20 g each (carb-solved); assumed (proportions unknown, rava drives fibre) |
| pesarattu | 7.0 | 0.3 | B011 40.5 g + A015 4.8 g (carb and protein solved) |
| pongal | 1.4 | 0.2 | A015 16.1 g + B010 9.7 g (carb and protein solved); cashew ignored |
| curd_rice | 0.6 | 2.0 | Cooked rice 0.59 (A015 ÷ 2.98) + dairy 0.41 (curd/milk ~4.7 sugar) |
| lemon_rice | 1.2 | 0.4 | Cooked rice 0.91 + H012 ~3.5 g; assumed |
| ghee_rice | 1.0 | 0.4 | Cooked rice 0.91 + onion 3 g + cashew 2 g; assumed |
| chicken_fry | 0.1 | 0.1 | Flour carb 3.2 taken as maida (A018); assumed |
| chicken_65 | 0.2 | 0.1 | Batter carb 8.1 as part maida (A018); assumed |
| prawn_curry | 0.9 | 0.8 | H007 ~4 g + onion/tomato masala; S010 adds none; assumed |
| mutton_curry | 0.9 | 1.2 | Masala carb 2.4; O003 adds none; assumed |
| semiya_payasam | 1.4 | 7.0 | Vermicelli ~14 g (A023) + milk ~61 g (lactose 2.98) + added sugar ~3.8 g (carb remainder); assumed |
| moru | 0 | 1.2 | 25% curd (4.66) |
| butter_chicken | 0.8 | 1.2 | Cashew 3 g + tomato/onion masala; cream lactose left out; assumed |
| keema | 1.5 | 1.9 | Masala carb 3.9; O003 adds none |
| egg_bhurji | 0.8 | 1.0 | Masala carb 2.0 |
| kadai_paneer | 0.9 | 5.1 | L003 ~34.5 g (protein-solved) + masala for the leftover carb; assumed |
| matar_paneer | 2.1 | 4.2 | L003 ~26 g + D061 20 g + masala; assumed |
| paneer_tikka | 0.5 | 9.6 | L003 ~75 g + curd 8 g + vegetables; assumed (paneer drives the sugar) |
| dal_makhani | 4.1 | 0.3 | Pulses ~23.7 g raw (carb-solved), rajma-level fibre and urad-level sugar (lower bound) + tomato; cream lactose left out; assumed |
| bhindi_sabzi | 4.0 | 1.7 | D056 ~85 g + G017 ~22 g (protein and carb solved) |
| baingan_bharta | 3.9 | 1.9 | D031 ~83 g + onion 15 g + tomato 20 g; amounts assumed |
| khichdi | 1.5 | 0.3 | A015 ~15.6 g + B010 ~9.5 g (solved) + a little vegetable; assumed |
| veg_pulao | 1.4 | 0.7 | Cooked rice 0.78 + vegetables (leftover carb 1.4); assumed |
| chicken_fried_rice | 1.3 | 0.7 | Cooked rice 0.61 + vegetables; assumed |
| veg_fried_rice | 1.8 | 1.0 | Cooked rice 0.62 + vegetable carb 2.5; assumed |
| egg_fried_rice | 1.4 | 0.8 | Cooked rice 0.6 + vegetable carb 1.75; assumed |
| samosa | 1.3 | 0.7 | A018 36.8 g + F006 15 g (carb-solved, best fit); assumed |
| vada_pav | 2.5 | 0.6 | Pav 55% (maida) + vada 45% (potato/besan) by carb; assumed |
| pakora | 6.5 | 1.9 | Besan proxied by B001 ~41.5 g + onion ~25–30 g (protein-solved); assumed |
| dhokla | 5.2 | 3.7 | B001 proxy 34 g + curd 15 g + added sugar ~2.7 g (carb remainder); assumed |
| gulab_jamun | 0.3 | 37.0 | L004 ~27 g + A018 10 g; syrup sugar 32.6 g is the carb remainder; range 37–41; assumed |
| sweet_lassi | 0 | 14.3 | 50% curd (2.33) + 12 g sugar |
| roasted_peanuts | 10.4 | 4.4 | IFCT H012 |
| roasted_chana | 25.2 | 1.0 | IFCT B002, no roasting correction |
| coconut_water | 0 | 3.1 | IFCT K002 (3.06) |
| grilled_chicken_breast | 0 | 0 | USDA 171477 |
| oats_milk | 1.3 | 4.2 | Oats 30 g (USDA 173904) + toned milk 200 g (4.65 sugar) over 230 g |
| peanut_butter | 8.0 | 8.4 | USDA 172469 |
| bread | 2.7 | 4.3 | Lower of white (fibre 2.7, sugar 5.67) and whole wheat (6.0, 4.34); row mixes both |
| egg_white | 0 | 0 | IFCT M005; carb 0 |
| moong_sprouts | 4.6 | 0.4 | B011 ×0.333 (70% moisture) at 0.747 share + tomato; assumed |
| almonds | 12.5 | 2.2 | Fibre: USDA 170567 (12.5, lower than IFCT 13.06). Sugar: IFCT H001 (2.23, lower than USDA 4.35) |
| dates | 6.7 | 66.5 | USDA 168191 (6.7 / 66.5; IFCT E017 is 8.95 / 66.63) |
| apple | 2.4 | 8.4 | Fibre: USDA 171688 (2.4, lower than IFCT 2.54). Sugar: IFCT E002 (8.39, lower than USDA 10.39) |
| paneer_bhurji | 0.9 | 7.8 | L003 100 g + G017 40 g + D076/D075 40 g over 184.5 g (carb and protein agree) |
| kappa | 4.6 | 2.1 | IFCT F015, yield 1.0 assumed |
| kadala_curry | 5.8 | 1.1 | B002 20 g + H007 5 g + onion ~10 g (carb remainder); assumed |
| egg_roast | 2.6 | 3.3 | Masala carb 6.6 at fibre 0.4 and sugar 0.5 per g; amounts assumed |
| beef_curry | 1.1 | 1.2 | H007 2 g + masala carb 2.27; assumed |
| chicken_stew | 1.4 | 1.1 | F006 20 g + H007 8 g + onion ~9.6 g (carb remainder) |
| pazhampori | 1.5 | 9.7 | E012 55 g + A018 14 g + sugar 2 g (quantities per 100 g, carb matches 25.4) |
| shawarma_roll | 1.0 | 0.5 | Pita as maida-equivalent + 30 g vegetables (C015-like); mayo sugar left out; assumed |
| chicken_burger | 0.9 | 0.6 | Maida-equivalent only; bun and sauce sugar left out (likely low); assumed |
| pizza_slice | 1.7 | 1.5 | Crust as maida (A018) + sauce carb 1.5; mozzarella lactose left out (likely low); assumed |
| chicken_momos | 1.2 | 0.7 | Dough 38 g at 30% water = maida ~25 g (carb matches) + cabbage/onion ~20 g; assumed |
| hakka_noodles | null | null | Row macros come from INDB ASC134; INDB.xlsx unreadable here, and an ingredient build would not match the row's derivation |
| chilli_chicken | null | null | Row macros come from INDB ASC244; same reason |
| gobi_manchurian | 2.6 | 0.5 | D036 60 g + A018 14 g; sauce sugar left out (lower bound); assumed |
| kathi_roll_chicken | 2.9 | 1.2 | Paratha-row 60 g (7.8 / 1.2) + onion for the leftover carb over 185 g; assumed |
| chicken_sandwich | null | null | Row macros come from INDB ASC043; same reason |
| veg_grilled_sandwich | null | null | Row macros come from INDB ASC040; same reason |
| tandoori_chicken | null | null | Row macros come from INDB ASC241; same reason |
| chicken_tikka | 0 | 0.6 | Curd ~12.8 g (carb 0.6 × 4.66/4.7); cooked chicken breast adds none |
| chicken_rice_bowl | 0.7 | 0.5 | Cooked rice 130 g (A015 ÷ 2.98) + gravy masala carb 2.4 over 290 g |
| maggi | 0.6 | 0.5 | Retailer listing (389 kcal, fibre 2.0, sugars 1.8 per 100 g dry, https://thedesifood.com/products/maggi-2-minute-masala-instant-noodles) × 0.28 (70 g in 250 g); its carb 59.6 × 0.28 = 16.7 matches the row, but maggi.in itself couldn't be fetched |

## Null or low-confidence rows

**Null (5).** hakka_noodles, chilli_chicken, chicken_sandwich, veg_grilled_sandwich and tandoori_chicken. Their macros come from INDB.xlsx, which I couldn't read.

**Low confidence, recipe proportions unknown (back-solved from carb/protein).**
- Biryani, pulao and fried rice: veg_biryani, chicken_biryani, veg_pulao, chicken_fried_rice, veg_fried_rice, egg_fried_rice.
- Vegetable and coconut dishes: sabzi, thoran, avial, olan, erissery, moru_curry, kootu, sambar, rasam, baingan_bharta, bhindi_sabzi.
- Gravies and masala dishes: egg_curry, egg_roast, chicken_curry, mutton_curry, keema, beef_fry, beef_curry, fish_curry, prawn_curry, butter_chicken, chicken_stew, kadala_curry.
- Batters and doughs: rava_dosa (rava share drives fibre), uttapam, masala_dosa, vada_pav, samosa, pakora, dhokla (besan proxied by B001, chana dal).
- Sweets: gulab_jamun (sugar range 37–41), semiya_payasam.
- Delivery and restaurant: shawarma_roll, chicken_burger, pizza_slice, chicken_momos, gobi_manchurian, kathi_roll_chicken. The last four understate sugar (bun, dough, sauce and cheese sugar left out).
- dal_makhani: cream lactose left out.

**Paneer rows (palak_paneer, paneer_butter_masala, kadai_paneer, matar_paneer, paneer_tikka, paneer_bhurji).** IFCT L003 lists carb 12.41 and free sugars 11.57 per 100 g. That is far above typical paneer (about 1–3 g). The table's carbs already inherit it, and the sugar here tracks the carb. If you correct the paneer carb, correct these sugars with it.

**Source mismatches.**
- bread mixes white-bread macros with a whole-wheat energy figure.
- almonds and apple take fibre and sugar from different sources, by the lower-number rule.
- roti, paratha and puri fibre (7.6–8.6 g/100 g) follows IFCT atta TDF of 11.36 g; commercial labels are lower.

**Confirmed only by carb = 0 (not read from the file).** boiled_egg, omelette, egg_white, fish_fry, and the meat and prawn contributions.

## Correction 2026-10-21
Paneer sugar recomputed: the paneer share now carries 1.5 g sugar per 100 g paneer (assumed, low end of typical 1–3 g) instead of IFCT L003's 11.57 g. Shares as in the table above: palak_paneer 0.9, paneer_butter_masala 1.4, kadai_paneer 1.6, matar_paneer 1.6, paneer_tikka 2.0, paneer_bhurji 2.3 (g sugar per 100 g dish). The rows' carb_100 (and kcal) still inherit L003's high carb: open item.
