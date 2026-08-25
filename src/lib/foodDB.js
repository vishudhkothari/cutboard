/* ═══════════════════════════════════════════════════════════════
   INDIAN VEGETARIAN FOOD DATABASE
   All values per 100g RAW/DRY weight unless unit says otherwise.
   Indian cooking is measured raw (dry dal, uncooked rice), so weigh
   the dry ingredient and scale. For items counted in pieces or scoops,
   `unit` and `perUnit` define one serving.

   Fields: id, name, cat, kcal, protein, carbs, fat, unit, perUnit(g)
   unit: 'g' (weigh in grams) | 'piece' | 'scoop' | 'cup' | 'tbsp' | 'ml'
   perUnit: grams in one piece/scoop/etc (for non-gram units)
═══════════════════════════════════════════════════════════════ */
import { scaleMicros } from './nutrientEngine'

/* Priority vegetarian profiles per 100g edible/raw basis. Values are kept in
   the same shape as the food record so the database can be expanded without
   changing calculation code. Foods without a profile remain explicitly
   unknown to the coach rather than silently contributing zero. */
const MICRO_PROFILES = {
  toor_dal:{iron_mg:5.1,magnesium_mg:183,phosphorus_mg:367,potassium_mg:1392,zinc_mg:2.8,copper_mg:.8,selenium_ug:6,thiamin_mg:.48,riboflavin_mg:.19,niacin_mg:2.9,vitamin_b6_mg:.28,folate_ug:274},
  moong_dal:{iron_mg:6.7,magnesium_mg:189,phosphorus_mg:367,potassium_mg:1246,zinc_mg:2.7,copper_mg:.94,selenium_ug:8,thiamin_mg:.62,riboflavin_mg:.23,niacin_mg:2.25,vitamin_b6_mg:.38,folate_ug:625},
  masoor_dal:{iron_mg:7.5,magnesium_mg:178,phosphorus_mg:451,potassium_mg:955,zinc_mg:3.6,copper_mg:.75,selenium_ug:8,thiamin_mg:.87,riboflavin_mg:.21,niacin_mg:2.6,vitamin_b6_mg:.54,folate_ug:479},
  chana_dal:{iron_mg:4.3,magnesium_mg:166,phosphorus_mg:366,potassium_mg:875,zinc_mg:3.4,copper_mg:.85,selenium_ug:7,thiamin_mg:.49,riboflavin_mg:.11,niacin_mg:2.9,vitamin_b6_mg:.49,folate_ug:437},
  rajma:{iron_mg:8.2,magnesium_mg:140,phosphorus_mg:406,potassium_mg:1359,zinc_mg:2.8,copper_mg:.89,selenium_ug:11,thiamin_mg:.61,riboflavin_mg:.17,niacin_mg:2.1,vitamin_b6_mg:.4,folate_ug:394},
  chickpea:{iron_mg:6.2,magnesium_mg:115,phosphorus_mg:366,potassium_mg:875,zinc_mg:3.4,copper_mg:.85,selenium_ug:8,thiamin_mg:.48,riboflavin_mg:.11,niacin_mg:1.5,vitamin_b6_mg:.54,folate_ug:557},
  soya_chunks:{iron_mg:9.1,calcium_mg:277,magnesium_mg:280,phosphorus_mg:704,potassium_mg:1797,zinc_mg:4.9,copper_mg:1.2,selenium_ug:7,thiamin_mg:.7,riboflavin_mg:.4,niacin_mg:2.2,vitamin_b6_mg:.5,folate_ug:375},
  white_rice:{iron_mg:.8,magnesium_mg:25,phosphorus_mg:115,potassium_mg:115,zinc_mg:1.1,thiamin_mg:.07,niacin_mg:1.6,folate_ug:8},
  brown_rice:{iron_mg:1.5,magnesium_mg:143,phosphorus_mg:333,potassium_mg:223,zinc_mg:2.0,copper_mg:.3,selenium_ug:23,thiamin_mg:.4,riboflavin_mg:.1,niacin_mg:5.1,vitamin_b6_mg:.51,folate_ug:23},
  wheat_flour:{iron_mg:3.9,magnesium_mg:138,phosphorus_mg:346,potassium_mg:405,zinc_mg:2.9,copper_mg:.4,selenium_ug:70,thiamin_mg:.45,riboflavin_mg:.17,niacin_mg:5.5,vitamin_b6_mg:.34,folate_ug:44},
  besan:{iron_mg:4.9,magnesium_mg:166,phosphorus_mg:318,potassium_mg:846,zinc_mg:2.8,copper_mg:.91,thiamin_mg:.49,riboflavin_mg:.11,niacin_mg:1.8,vitamin_b6_mg:.49,folate_ug:437},
  oats:{iron_mg:4.7,calcium_mg:54,magnesium_mg:177,phosphorus_mg:523,potassium_mg:429,zinc_mg:4,copper_mg:.63,selenium_ug:28,thiamin_mg:.76,riboflavin_mg:.14,niacin_mg:0.96,vitamin_b6_mg:.12,folate_ug:56},
  ragi:{iron_mg:3.9,calcium_mg:344,magnesium_mg:146,phosphorus_mg:283,potassium_mg:408,zinc_mg:2.7,copper_mg:.47,thiamin_mg:.48,riboflavin_mg:.12,niacin_mg:1.1,folate_ug:34},
  quinoa:{iron_mg:4.6,calcium_mg:47,magnesium_mg:197,phosphorus_mg:457,potassium_mg:563,zinc_mg:3.1,copper_mg:.59,selenium_ug:8,thiamin_mg:.36,riboflavin_mg:.32,niacin_mg:1.5,vitamin_b6_mg:.49,folate_ug:184},
  paneer:{calcium_mg:208,phosphorus_mg:138,potassium_mg:104,zinc_mg:2.3,selenium_ug:14,vitamin_a_ug:210,vitamin_b12_ug:1.2,riboflavin_mg:.2,vitamin_d_ug:.1},
  tofu:{calcium_mg:350,iron_mg:5.4,magnesium_mg:30,phosphorus_mg:97,potassium_mg:121,zinc_mg:.8,copper_mg:.2,selenium_ug:17,thiamin_mg:.08,riboflavin_mg:.1,vitamin_b6_mg:.05,folate_ug:15},
  curd:{calcium_mg:121,phosphorus_mg:95,potassium_mg:150,zinc_mg:.6,selenium_ug:3,vitamin_a_ug:31,riboflavin_mg:.14,vitamin_b12_ug:.4},
  greek_yogurt:{calcium_mg:110,phosphorus_mg:135,potassium_mg:141,zinc_mg:.5,selenium_ug:9,vitamin_a_ug:27,riboflavin_mg:.14,vitamin_b12_ug:.8},
  milk_full:{calcium_mg:113,magnesium_mg:10,phosphorus_mg:84,potassium_mg:132,zinc_mg:.4,selenium_ug:3,vitamin_a_ug:46,vitamin_d_ug:1.2,riboflavin_mg:.14,vitamin_b12_ug:.4},
  milk_toned:{calcium_mg:120,magnesium_mg:11,phosphorus_mg:95,potassium_mg:150,zinc_mg:.4,selenium_ug:3,vitamin_a_ug:20,vitamin_d_ug:1.2,riboflavin_mg:.18,vitamin_b12_ug:.4},
  whey_iso:{calcium_mg:500,phosphorus_mg:250,potassium_mg:400,zinc_mg:1,selenium_ug:20,riboflavin_mg:.5,vitamin_b12_ug:1},
  spinach:{calcium_mg:99,iron_mg:2.7,magnesium_mg:79,phosphorus_mg:49,potassium_mg:558,zinc_mg:.5,copper_mg:.13,vitamin_a_ug:469,vitamin_c_mg:28,vitamin_e_mg:2,vitamin_k_ug:483,thiamin_mg:.08,riboflavin_mg:.19,vitamin_b6_mg:.2,folate_ug:194},
  potato:{iron_mg:.8,magnesium_mg:23,phosphorus_mg:57,potassium_mg:425,zinc_mg:.3,vitamin_c_mg:20,vitamin_b6_mg:.3,folate_ug:15},
  tomato:{calcium_mg:10,iron_mg:.3,magnesium_mg:11,phosphorus_mg:24,potassium_mg:237,vitamin_a_ug:42,vitamin_c_mg:14,vitamin_k_ug:8,folate_ug:15},
  peas:{calcium_mg:25,iron_mg:1.5,magnesium_mg:33,phosphorus_mg:108,potassium_mg:244,zinc_mg:1.2,vitamin_a_ug:38,vitamin_c_mg:40,vitamin_k_ug:25,thiamin_mg:.26,folate_ug:65},
  carrot:{calcium_mg:33,iron_mg:.3,magnesium_mg:12,phosphorus_mg:35,potassium_mg:320,vitamin_a_ug:835,vitamin_c_mg:5.9,vitamin_k_ug:13,folate_ug:19},
  mushroom:{calcium_mg:3,iron_mg:.5,magnesium_mg:9,phosphorus_mg:86,potassium_mg:318,zinc_mg:.5,selenium_ug:9,vitamin_d_ug:.2,niacin_mg:3.6,riboflavin_mg:.4},
  almonds:{calcium_mg:269,iron_mg:3.7,magnesium_mg:270,phosphorus_mg:481,potassium_mg:733,zinc_mg:3.1,copper_mg:1,selenium_ug:4,vitamin_e_mg:25,thiamin_mg:.21,riboflavin_mg:1.1,niacin_mg:3.6,folate_ug:44},
  cashew:{calcium_mg:37,iron_mg:6.7,magnesium_mg:292,phosphorus_mg:593,potassium_mg:660,zinc_mg:5.8,copper_mg:2.2,selenium_ug:19,vitamin_e_mg:.9,thiamin_mg:.42,vitamin_b6_mg:.42,folate_ug:25},
  peanuts:{magnesium_mg:168,phosphorus_mg:376,potassium_mg:705,zinc_mg:3.3,copper_mg:1.1,selenium_ug:7,vitamin_e_mg:8.3,thiamin_mg:.64,niacin_mg:12,vitamin_b6_mg:.35,folate_ug:240},
  flax_seeds:{calcium_mg:255,iron_mg:5.7,magnesium_mg:392,phosphorus_mg:642,potassium_mg:813,zinc_mg:4.3,copper_mg:1.2,thiamin_mg:1.6,vitamin_b6_mg:.47,folate_ug:87},
  chia_seeds:{calcium_mg:631,iron_mg:7.7,magnesium_mg:335,phosphorus_mg:860,potassium_mg:407,zinc_mg:4.6,copper_mg:.92,selenium_ug:55,thiamin_mg:.62,vitamin_b6_mg:.5,folate_ug:49},
  banana:{magnesium_mg:27,phosphorus_mg:22,potassium_mg:358,vitamin_a_ug:3,vitamin_c_mg:8.7,vitamin_b6_mg:.37,folate_ug:20},
  apple:{potassium_mg:107,vitamin_a_ug:3,vitamin_c_mg:4.6,vitamin_k_ug:2.2,folate_ug:3},
  orange:{calcium_mg:40,magnesium_mg:10,potassium_mg:181,vitamin_a_ug:11,vitamin_c_mg:53,folate_ug:30},
  guava:{calcium_mg:18,iron_mg:.3,magnesium_mg:22,phosphorus_mg:40,potassium_mg:417,vitamin_a_ug:31,vitamin_c_mg:228,vitamin_k_ug:2.6,folate_ug:49},
  pumpkin_seeds:{iron_mg:8.8,magnesium_mg:592,phosphorus_mg:1233,potassium_mg:919,zinc_mg:7.6,copper_mg:1.3,selenium_ug:9,vitamin_e_mg:2.2,thiamin_mg:.27,niacin_mg:4.99,vitamin_b6_mg:.14,folate_ug:58},
  sesame_seeds:{calcium_mg:975,iron_mg:14.6,magnesium_mg:351,phosphorus_mg:629,potassium_mg:468,zinc_mg:7.8,copper_mg:4.1,selenium_ug:34,thiamin_mg:.79,vitamin_b6_mg:.79,folate_ug:97},
  sunflower_seeds:{iron_mg:5.3,magnesium_mg:325,phosphorus_mg:660,potassium_mg:645,zinc_mg:5,copper_mg:1.8,selenium_ug:53,vitamin_e_mg:35,thiamin_mg:1.5,niacin_mg:8.3,vitamin_b6_mg:1.3,folate_ug:227},
  broccoli:{calcium_mg:47,iron_mg:.7,magnesium_mg:21,phosphorus_mg:66,potassium_mg:316,zinc_mg:.4,vitamin_a_ug:31,vitamin_c_mg:89,vitamin_e_mg:.8,vitamin_k_ug:102,folate_ug:63},
  beetroot:{calcium_mg:16,iron_mg:.8,magnesium_mg:23,phosphorus_mg:40,potassium_mg:325,vitamin_a_ug:2,vitamin_c_mg:4.9,vitamin_k_ug:.2,folate_ug:109},
  sweet_potato:{calcium_mg:30,iron_mg:.6,magnesium_mg:25,phosphorus_mg:47,potassium_mg:337,vitamin_a_ug:709,vitamin_c_mg:2.4,vitamin_e_mg:.3,vitamin_b6_mg:.21,folate_ug:11},
  amla:{calcium_mg:25,iron_mg:.3,magnesium_mg:10,phosphorus_mg:27,potassium_mg:198,vitamin_a_ug:15,vitamin_c_mg:600,folate_ug:6},
}

const FOOD_DB_RAW = [
  // ── Dals & Legumes (dry weight) ──────────────────────────────
  { id:'toor_dal',      name:'Toor/Arhar Dal (dry)',     cat:'Dal',     kcal:343, protein:22,  carbs:57, fat:1.5, fiber:15, unit:'g' },
  { id:'moong_dal',     name:'Moong Dal (dry)',          cat:'Dal',     kcal:347, protein:24,  carbs:59, fat:1.2, fiber:16, unit:'g' },
  { id:'masoor_dal',    name:'Masoor Dal (dry)',         cat:'Dal',     kcal:352, protein:25,  carbs:60, fat:1.1, fiber:11, unit:'g' },
  { id:'chana_dal',     name:'Chana Dal (dry)',          cat:'Dal',     kcal:364, protein:22,  carbs:60, fat:6, fiber:13,   unit:'g' },
  { id:'urad_dal',      name:'Urad Dal (dry)',           cat:'Dal',     kcal:341, protein:25,  carbs:59, fat:1.6, fiber:18, unit:'g' },
  { id:'rajma',         name:'Rajma / Kidney Beans (dry)',cat:'Dal',    kcal:333, protein:24,  carbs:60, fat:0.8, fiber:25, unit:'g' },
  { id:'chickpea',      name:'Kabuli Chana / Chickpea (dry)',cat:'Dal', kcal:364, protein:19,  carbs:61, fat:6, fiber:17,   unit:'g' },
  { id:'black_chana',   name:'Kala Chana (dry)',         cat:'Dal',     kcal:360, protein:20,  carbs:61, fat:5, fiber:18,   unit:'g' },
  { id:'green_moong',   name:'Whole Green Moong (dry)',  cat:'Dal',     kcal:347, protein:24,  carbs:63, fat:1.2, fiber:16, unit:'g' },
  { id:'lobia',         name:'Lobia / Black-eyed Peas (dry)',cat:'Dal', kcal:336, protein:24,  carbs:60, fat:1.3, fiber:11, unit:'g' },
  { id:'soya_chunks',   name:'Soya Chunks (dry)',        cat:'Dal',     kcal:345, protein:52,  carbs:33, fat:0.5, fiber:13, unit:'g' },

  // ── Rice & Grains (dry weight) ───────────────────────────────
  { id:'white_rice',    name:'White Rice (dry)',         cat:'Grain',   kcal:360, protein:6.8, carbs:79, fat:0.6, fiber:1.3, unit:'g' },
  { id:'basmati_rice',  name:'Basmati Rice (dry)',       cat:'Grain',   kcal:356, protein:7.5, carbs:78, fat:0.9, fiber:1.3, unit:'g' },
  { id:'brown_rice',    name:'Brown Rice (dry)',         cat:'Grain',   kcal:362, protein:7.5, carbs:76, fat:2.7, fiber:3.5, unit:'g' },
  { id:'poha',          name:'Poha / Flattened Rice (dry)',cat:'Grain', kcal:346, protein:6.6, carbs:77, fat:1.2, fiber:4, unit:'g' },
  { id:'wheat_flour',   name:'Whole Wheat Atta',         cat:'Grain',   kcal:340, protein:12,  carbs:72, fat:1.7, fiber:11, unit:'g' },
  { id:'maida',         name:'Maida / Refined Flour',    cat:'Grain',   kcal:364, protein:10,  carbs:76, fat:1, fiber:2.7,   unit:'g' },
  { id:'besan',         name:'Besan / Gram Flour',       cat:'Grain',   kcal:387, protein:22,  carbs:58, fat:7, fiber:11,   unit:'g' },
  { id:'suji',          name:'Suji / Semolina (dry)',    cat:'Grain',   kcal:360, protein:13,  carbs:73, fat:1, fiber:3.9,   unit:'g' },
  { id:'oats',          name:'Rolled Oats (dry)',        cat:'Grain',   kcal:389, protein:17,  carbs:66, fat:7, fiber:10,   unit:'g' },
  { id:'daliya',        name:'Daliya / Broken Wheat (dry)',cat:'Grain', kcal:342, protein:12,  carbs:76, fat:1.5, fiber:12, unit:'g' },
  { id:'ragi',          name:'Ragi Flour',               cat:'Grain',   kcal:336, protein:7.3, carbs:72, fat:1.3, fiber:11, unit:'g' },
  { id:'bajra',         name:'Bajra Flour',              cat:'Grain',   kcal:361, protein:11,  carbs:67, fat:5, fiber:11,   unit:'g' },
  { id:'jowar',         name:'Jowar Flour',              cat:'Grain',   kcal:349, protein:10,  carbs:72, fat:3.4, fiber:9.7, unit:'g' },
  { id:'quinoa',        name:'Quinoa (dry)',             cat:'Grain',   kcal:368, protein:14,  carbs:64, fat:6, fiber:7,   unit:'g' },
  { id:'sprouted_moong',name:'Moong Sprouts',             cat:'Dal',     kcal:30,  protein:3,   carbs:6,  fat:.2, fiber:1.8, unit:'g' },

  // ── Breads & Cooked staples (values per 100g) ────────────────
  { id:'roti',          name:'Roti / Chapati',           cat:'Bread',   kcal:297, protein:9,   carbs:57, fat:4, fiber:5,   unit:'piece', perUnit:35 },
  { id:'phulka',        name:'Phulka (no oil)',          cat:'Bread',   kcal:267, protein:9,   carbs:53, fat:1.7, fiber:5, unit:'piece', perUnit:30 },
  { id:'paratha',       name:'Plain Paratha',            cat:'Bread',   kcal:360, protein:8,   carbs:48, fat:16, fiber:4,  unit:'piece', perUnit:50 },
  { id:'naan',          name:'Naan',                     cat:'Bread',   kcal:291, protein:10,  carbs:50, fat:5.5, fiber:2.5, unit:'piece', perUnit:90 },
  { id:'idli',          name:'Idli',                     cat:'Bread',   kcal:145, protein:5,   carbs:30, fat:1, fiber:1.5,   unit:'piece', perUnit:40 },
  { id:'dosa',          name:'Plain Dosa',               cat:'Bread',   kcal:222, protein:5,   carbs:33, fat:7, fiber:1.7,   unit:'piece', perUnit:60 },

  // ── Protein: Whey & Dairy (values per 100g) ──────────────────
  { id:'whey_iso',      name:'Whey Isolate',             cat:'Protein', kcal:377, protein:90,  carbs:3,  fat:1.7, fiber:0, unit:'scoop', perUnit:30 },
  { id:'whey_conc',     name:'Whey Concentrate',         cat:'Protein', kcal:375, protein:75,  carbs:9,  fat:4.7, fiber:0, unit:'scoop', perUnit:32 },
  { id:'paneer',        name:'Paneer',                   cat:'Protein', kcal:296, protein:18,  carbs:3,  fat:25, fiber:0,  unit:'g' },
  { id:'tofu',          name:'Tofu',                     cat:'Protein', kcal:76,  protein:8,   carbs:1.9,fat:4.8, fiber:0.3, unit:'g' },
  { id:'curd',          name:'Curd / Dahi (full fat)',   cat:'Protein', kcal:98,  protein:11,  carbs:4.7,fat:4.3, fiber:0, unit:'g' },
  { id:'greek_yogurt',  name:'Greek Yogurt',             cat:'Protein', kcal:97,  protein:9,   carbs:4,  fat:5, fiber:0,   unit:'g' },
  { id:'milk_full',     name:'Milk (full fat)',          cat:'Protein', kcal:62,  protein:3.2, carbs:4.8,fat:3.3, fiber:0, unit:'ml' },
  { id:'milk_toned',    name:'Milk (toned)',             cat:'Protein', kcal:47,  protein:3.1, carbs:4.7,fat:1.5, fiber:0, unit:'ml' },
  { id:'cheese',        name:'Cheese (processed)',       cat:'Protein', kcal:330, protein:20,  carbs:3,  fat:26, fiber:0,  unit:'g' },

  // ── Vegetables (raw) ─────────────────────────────────────────
  { id:'potato',        name:'Potato (raw)',             cat:'Veg',     kcal:77,  protein:2,   carbs:17, fat:0.1, fiber:2.2, unit:'g' },
  { id:'onion',         name:'Onion',                    cat:'Veg',     kcal:40,  protein:1.1, carbs:9,  fat:0.1, fiber:1.7, unit:'g' },
  { id:'tomato',        name:'Tomato',                   cat:'Veg',     kcal:18,  protein:0.9, carbs:3.9,fat:0.2, fiber:1.2, unit:'g' },
  { id:'spinach',       name:'Spinach / Palak',          cat:'Veg',     kcal:23,  protein:2.9, carbs:3.6,fat:0.4, fiber:2.2, unit:'g' },
  { id:'cauliflower',   name:'Cauliflower / Gobi',       cat:'Veg',     kcal:25,  protein:1.9, carbs:5,  fat:0.3, fiber:2, unit:'g' },
  { id:'peas',          name:'Green Peas',               cat:'Veg',     kcal:81,  protein:5,   carbs:14, fat:0.4, fiber:5, unit:'g' },
  { id:'carrot',        name:'Carrot',                   cat:'Veg',     kcal:41,  protein:0.9, carbs:10, fat:0.2, fiber:2.8, unit:'g' },
  { id:'bhindi',        name:'Bhindi / Okra',            cat:'Veg',     kcal:33,  protein:1.9, carbs:7,  fat:0.2, fiber:3.2, unit:'g' },
  { id:'brinjal',       name:'Brinjal / Baingan',        cat:'Veg',     kcal:25,  protein:1,   carbs:6,  fat:0.2, fiber:3, unit:'g' },
  { id:'capsicum',      name:'Capsicum',                 cat:'Veg',     kcal:20,  protein:0.9, carbs:4.6,fat:0.2, fiber:1.7, unit:'g' },
  { id:'bottle_gourd',  name:'Lauki / Bottle Gourd',     cat:'Veg',     kcal:14,  protein:0.6, carbs:3.4,fat:0.0, fiber:0.5, unit:'g' },
  { id:'cucumber',      name:'Cucumber',                 cat:'Veg',     kcal:15,  protein:0.7, carbs:3.6,fat:0.1, fiber:0.5, unit:'g' },
  { id:'mushroom',      name:'Mushroom',                 cat:'Veg',     kcal:22,  protein:3.1, carbs:3.3,fat:0.3, fiber:1, unit:'g' },
  { id:'broccoli',      name:'Broccoli',                 cat:'Veg',     kcal:34,  protein:2.8, carbs:7,  fat:.4, fiber:2.6, unit:'g' },
  { id:'beetroot',      name:'Beetroot',                 cat:'Veg',     kcal:43,  protein:1.6, carbs:10, fat:.2, fiber:2.8, unit:'g' },
  { id:'sweet_potato',  name:'Sweet Potato',             cat:'Veg',     kcal:86,  protein:1.6, carbs:20, fat:.1, fiber:3, unit:'g' },

  // ── Fats & Oils ──────────────────────────────────────────────
  { id:'ghee',          name:'Ghee',                     cat:'Fat',     kcal:900, protein:0,   carbs:0,  fat:100, fiber:0, unit:'g' },
  { id:'oil',           name:'Cooking Oil',              cat:'Fat',     kcal:884, protein:0,   carbs:0,  fat:100, fiber:0, unit:'g' },
  { id:'butter',        name:'Butter',                   cat:'Fat',     kcal:717, protein:0.9, carbs:0.1,fat:81, fiber:0,  unit:'g' },
  { id:'peanut_butter', name:'Peanut Butter',            cat:'Fat',     kcal:588, protein:25,  carbs:20, fat:50, fiber:6,  unit:'g' },
  { id:'almonds',       name:'Almonds',                  cat:'Fat',     kcal:579, protein:21,  carbs:22, fat:50, fiber:12,  unit:'g' },
  { id:'cashew',        name:'Cashew',                   cat:'Fat',     kcal:553, protein:18,  carbs:30, fat:44, fiber:3.3,  unit:'g' },
  { id:'walnut',        name:'Walnut',                   cat:'Fat',     kcal:654, protein:15,  carbs:14, fat:65, fiber:6.7,  unit:'g' },
  { id:'peanuts',       name:'Peanuts',                  cat:'Fat',     kcal:567, protein:26,  carbs:16, fat:49, fiber:8.5,  unit:'g' },
  { id:'flax_seeds',    name:'Flax Seeds',               cat:'Fat',     kcal:534, protein:18,  carbs:29, fat:42, fiber:27,  unit:'g' },
  { id:'chia_seeds',    name:'Chia Seeds',               cat:'Fat',     kcal:486, protein:17,  carbs:42, fat:31, fiber:34,  unit:'g' },
  { id:'pumpkin_seeds', name:'Pumpkin Seeds',             cat:'Fat',     kcal:559, protein:30,  carbs:11, fat:49, fiber:6, unit:'g' },
  { id:'sesame_seeds',  name:'Sesame Seeds',              cat:'Fat',     kcal:573, protein:18,  carbs:23, fat:50, fiber:12, unit:'g' },
  { id:'sunflower_seeds',name:'Sunflower Seeds',          cat:'Fat',     kcal:584, protein:21,  carbs:20, fat:51, fiber:8.6, unit:'g' },
  { id:'coconut',       name:'Fresh Coconut',            cat:'Fat',     kcal:354, protein:3.3, carbs:15, fat:33, fiber:9,  unit:'g' },

  // ── Fruits (values per 100g) ─────────────────────────────────
  { id:'banana',        name:'Banana',                   cat:'Fruit',   kcal:89,  protein:1.1, carbs:23, fat:0.3, fiber:2.6, unit:'piece', perUnit:118 },
  { id:'apple',         name:'Apple',                    cat:'Fruit',   kcal:52,  protein:0.3, carbs:14, fat:0.2, fiber:2.4, unit:'piece', perUnit:180 },
  { id:'mango',         name:'Mango',                    cat:'Fruit',   kcal:60,  protein:0.8, carbs:15, fat:0.4, fiber:1.6, unit:'g' },
  { id:'orange',        name:'Orange',                   cat:'Fruit',   kcal:47,  protein:0.9, carbs:12, fat:0.1, fiber:2.4, unit:'piece', perUnit:130 },
  { id:'papaya',        name:'Papaya',                   cat:'Fruit',   kcal:43,  protein:0.5, carbs:11, fat:0.3, fiber:1.7, unit:'g' },
  { id:'guava',         name:'Guava',                    cat:'Fruit',   kcal:68,  protein:2.6, carbs:14, fat:1, fiber:5.4,   unit:'piece', perUnit:100 },
  { id:'amla',           name:'Amla / Indian Gooseberry',cat:'Fruit',   kcal:44,  protein:.9, carbs:10, fat:.6, fiber:4.3, unit:'piece', perUnit:35 },
  { id:'dates',         name:'Dates',                    cat:'Fruit',   kcal:277, protein:1.8, carbs:75, fat:0.2, fiber:8, unit:'piece', perUnit:8 },

  // ── Misc / Condiments ────────────────────────────────────────
  { id:'sugar',         name:'Sugar',                    cat:'Misc',    kcal:387, protein:0,   carbs:100,fat:0, fiber:0,   unit:'g' },
  { id:'jaggery',       name:'Jaggery / Gur',            cat:'Misc',    kcal:383, protein:0.4, carbs:98, fat:0.1, fiber:0, unit:'g' },
  { id:'honey',         name:'Honey',                    cat:'Misc',    kcal:304, protein:0.3, carbs:82, fat:0, fiber:0.2,   unit:'g' },
  { id:'coconut_milk',  name:'Coconut Milk',             cat:'Misc',    kcal:230, protein:2.3, carbs:6,  fat:24, fiber:2.2,  unit:'ml' },
]

export const FOOD_DB = FOOD_DB_RAW.map(food => ({
  ...food,
  ...(MICRO_PROFILES[food.id] ? { micros: MICRO_PROFILES[food.id], microSource: 'reference-profile' } : {}),
}))

export const FOOD_CATS = ['Dal','Grain','Bread','Protein','Veg','Fat','Fruit','Misc']

/* Build a meal-log entry from a food + amount. Carries provenance
   (foodId + amount) so the entry can later be re-edited by amount alone —
   the macros recompute instead of the user redoing the math. */
const UNIT_PLURAL = { piece:'pieces', scoop:'scoops', cup:'cups', tbsp:'tbsp' }
export function mealFromFood(food, amount) {
  const m = computeFoodNutrition(food, amount)
  const unitTxt = (food.unit === 'g' || food.unit === 'ml')
    ? `${m.grams}${food.unit}`
    : `${amount} ${UNIT_PLURAL[food.unit] || food.unit}`
  return {
    name: `${food.name} (${unitTxt})`,
    cals: m.cals, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber,
    ...(m.micros ? { micros: m.micros } : {}),
    foodId: food.id, amount: +amount,
  }
}

/* Build a meal-log entry from a saved recipe + servings count. Carries
   recipeId + amount so it stays smart-editable by servings. */
export function mealFromRecipe(recipe, servings = 1) {
  const ps = recipe.perServing
  const r1 = x => Math.round(x * servings * 10) / 10
  return {
    name: `${recipe.name}${servings !== 1 ? ` ×${servings}` : ''}`,
    cals: Math.round(ps.cals * servings),
    protein: r1(ps.protein), carbs: r1(ps.carbs), fat: r1(ps.fat), fiber: r1(ps.fiber || 0),
    ...(ps.micros ? { micros: scaleMicros(ps.micros, servings) } : {}),
    recipeId: recipe.id, amount: +servings,
  }
}

/* Compute macros for a given food + amount.
   amount is in the food's unit (grams, or count of pieces/scoops). */
export function computeFoodNutrition(food, amount) {
  const grams = (food.unit === 'g' || food.unit === 'ml')
    ? amount
    : amount * (food.perUnit || 100)
  const factor = grams / 100
  return {
    cals:    Math.round(food.kcal * factor),
    protein: Math.round(food.protein * factor * 10) / 10,
    carbs:   Math.round(food.carbs * factor * 10) / 10,
    fat:     Math.round(food.fat * factor * 10) / 10,
    fiber:   Math.round((food.fiber || 0) * factor * 10) / 10,
    ...(food.micros ? { micros: scaleMicros(food.micros, factor) } : {}),
    grams:   Math.round(grams),
  }
}

/* Kept as a compatibility alias for existing callers. */
export function computeFoodMacros(food, amount) {
  return computeFoodNutrition(food, amount)
}
