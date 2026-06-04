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
export const FOOD_DB = [
  // ── Dals & Legumes (dry weight) ──────────────────────────────
  { id:'toor_dal',      name:'Toor/Arhar Dal (dry)',     cat:'Dal',     kcal:343, protein:22,  carbs:57, fat:1.5, unit:'g' },
  { id:'moong_dal',     name:'Moong Dal (dry)',          cat:'Dal',     kcal:347, protein:24,  carbs:59, fat:1.2, unit:'g' },
  { id:'masoor_dal',    name:'Masoor Dal (dry)',         cat:'Dal',     kcal:352, protein:25,  carbs:60, fat:1.1, unit:'g' },
  { id:'chana_dal',     name:'Chana Dal (dry)',          cat:'Dal',     kcal:364, protein:22,  carbs:60, fat:6,   unit:'g' },
  { id:'urad_dal',      name:'Urad Dal (dry)',           cat:'Dal',     kcal:341, protein:25,  carbs:59, fat:1.6, unit:'g' },
  { id:'rajma',         name:'Rajma / Kidney Beans (dry)',cat:'Dal',    kcal:333, protein:24,  carbs:60, fat:0.8, unit:'g' },
  { id:'chickpea',      name:'Kabuli Chana / Chickpea (dry)',cat:'Dal', kcal:364, protein:19,  carbs:61, fat:6,   unit:'g' },
  { id:'black_chana',   name:'Kala Chana (dry)',         cat:'Dal',     kcal:360, protein:20,  carbs:61, fat:5,   unit:'g' },
  { id:'green_moong',   name:'Whole Green Moong (dry)',  cat:'Dal',     kcal:347, protein:24,  carbs:63, fat:1.2, unit:'g' },
  { id:'lobia',         name:'Lobia / Black-eyed Peas (dry)',cat:'Dal', kcal:336, protein:24,  carbs:60, fat:1.3, unit:'g' },
  { id:'soya_chunks',   name:'Soya Chunks (dry)',        cat:'Dal',     kcal:345, protein:52,  carbs:33, fat:0.5, unit:'g' },

  // ── Rice & Grains (dry weight) ───────────────────────────────
  { id:'white_rice',    name:'White Rice (dry)',         cat:'Grain',   kcal:360, protein:6.8, carbs:79, fat:0.6, unit:'g' },
  { id:'basmati_rice',  name:'Basmati Rice (dry)',       cat:'Grain',   kcal:356, protein:7.5, carbs:78, fat:0.9, unit:'g' },
  { id:'brown_rice',    name:'Brown Rice (dry)',         cat:'Grain',   kcal:362, protein:7.5, carbs:76, fat:2.7, unit:'g' },
  { id:'poha',          name:'Poha / Flattened Rice (dry)',cat:'Grain', kcal:346, protein:6.6, carbs:77, fat:1.2, unit:'g' },
  { id:'wheat_flour',   name:'Whole Wheat Atta',         cat:'Grain',   kcal:340, protein:12,  carbs:72, fat:1.7, unit:'g' },
  { id:'maida',         name:'Maida / Refined Flour',    cat:'Grain',   kcal:364, protein:10,  carbs:76, fat:1,   unit:'g' },
  { id:'besan',         name:'Besan / Gram Flour',       cat:'Grain',   kcal:387, protein:22,  carbs:58, fat:7,   unit:'g' },
  { id:'suji',          name:'Suji / Semolina (dry)',    cat:'Grain',   kcal:360, protein:13,  carbs:73, fat:1,   unit:'g' },
  { id:'oats',          name:'Rolled Oats (dry)',        cat:'Grain',   kcal:389, protein:17,  carbs:66, fat:7,   unit:'g' },
  { id:'daliya',        name:'Daliya / Broken Wheat (dry)',cat:'Grain', kcal:342, protein:12,  carbs:76, fat:1.5, unit:'g' },
  { id:'ragi',          name:'Ragi Flour',               cat:'Grain',   kcal:336, protein:7.3, carbs:72, fat:1.3, unit:'g' },
  { id:'bajra',         name:'Bajra Flour',              cat:'Grain',   kcal:361, protein:11,  carbs:67, fat:5,   unit:'g' },
  { id:'jowar',         name:'Jowar Flour',              cat:'Grain',   kcal:349, protein:10,  carbs:72, fat:3.4, unit:'g' },
  { id:'quinoa',        name:'Quinoa (dry)',             cat:'Grain',   kcal:368, protein:14,  carbs:64, fat:6,   unit:'g' },

  // ── Breads & Cooked staples (values per 100g) ────────────────
  { id:'roti',          name:'Roti / Chapati',           cat:'Bread',   kcal:297, protein:9,   carbs:57, fat:4,   unit:'piece', perUnit:35 },
  { id:'phulka',        name:'Phulka (no oil)',          cat:'Bread',   kcal:267, protein:9,   carbs:53, fat:1.7, unit:'piece', perUnit:30 },
  { id:'paratha',       name:'Plain Paratha',            cat:'Bread',   kcal:360, protein:8,   carbs:48, fat:16,  unit:'piece', perUnit:50 },
  { id:'naan',          name:'Naan',                     cat:'Bread',   kcal:291, protein:10,  carbs:50, fat:5.5, unit:'piece', perUnit:90 },
  { id:'idli',          name:'Idli',                     cat:'Bread',   kcal:145, protein:5,   carbs:30, fat:1,   unit:'piece', perUnit:40 },
  { id:'dosa',          name:'Plain Dosa',               cat:'Bread',   kcal:222, protein:5,   carbs:33, fat:7,   unit:'piece', perUnit:60 },

  // ── Protein: Whey & Dairy (values per 100g) ──────────────────
  { id:'whey_iso',      name:'Whey Isolate',             cat:'Protein', kcal:377, protein:90,  carbs:3,  fat:1.7, unit:'scoop', perUnit:30 },
  { id:'whey_conc',     name:'Whey Concentrate',         cat:'Protein', kcal:375, protein:75,  carbs:9,  fat:4.7, unit:'scoop', perUnit:32 },
  { id:'paneer',        name:'Paneer',                   cat:'Protein', kcal:296, protein:18,  carbs:3,  fat:25,  unit:'g' },
  { id:'tofu',          name:'Tofu',                     cat:'Protein', kcal:76,  protein:8,   carbs:1.9,fat:4.8, unit:'g' },
  { id:'curd',          name:'Curd / Dahi (full fat)',   cat:'Protein', kcal:98,  protein:11,  carbs:4.7,fat:4.3, unit:'g' },
  { id:'greek_yogurt',  name:'Greek Yogurt',             cat:'Protein', kcal:97,  protein:9,   carbs:4,  fat:5,   unit:'g' },
  { id:'milk_full',     name:'Milk (full fat)',          cat:'Protein', kcal:62,  protein:3.2, carbs:4.8,fat:3.3, unit:'ml' },
  { id:'milk_toned',    name:'Milk (toned)',             cat:'Protein', kcal:47,  protein:3.1, carbs:4.7,fat:1.5, unit:'ml' },
  { id:'cheese',        name:'Cheese (processed)',       cat:'Protein', kcal:330, protein:20,  carbs:3,  fat:26,  unit:'g' },
  { id:'egg',           name:'Whole Egg',                cat:'Protein', kcal:78,  protein:6.3, carbs:0.6,fat:5.3, unit:'piece', perUnit:50 },
  { id:'egg_white',     name:'Egg White',                cat:'Protein', kcal:17,  protein:3.6, carbs:0.2,fat:0.1, unit:'piece', perUnit:33 },

  // ── Vegetables (raw) ─────────────────────────────────────────
  { id:'potato',        name:'Potato (raw)',             cat:'Veg',     kcal:77,  protein:2,   carbs:17, fat:0.1, unit:'g' },
  { id:'onion',         name:'Onion',                    cat:'Veg',     kcal:40,  protein:1.1, carbs:9,  fat:0.1, unit:'g' },
  { id:'tomato',        name:'Tomato',                   cat:'Veg',     kcal:18,  protein:0.9, carbs:3.9,fat:0.2, unit:'g' },
  { id:'spinach',       name:'Spinach / Palak',          cat:'Veg',     kcal:23,  protein:2.9, carbs:3.6,fat:0.4, unit:'g' },
  { id:'cauliflower',   name:'Cauliflower / Gobi',       cat:'Veg',     kcal:25,  protein:1.9, carbs:5,  fat:0.3, unit:'g' },
  { id:'peas',          name:'Green Peas',               cat:'Veg',     kcal:81,  protein:5,   carbs:14, fat:0.4, unit:'g' },
  { id:'carrot',        name:'Carrot',                   cat:'Veg',     kcal:41,  protein:0.9, carbs:10, fat:0.2, unit:'g' },
  { id:'bhindi',        name:'Bhindi / Okra',            cat:'Veg',     kcal:33,  protein:1.9, carbs:7,  fat:0.2, unit:'g' },
  { id:'brinjal',       name:'Brinjal / Baingan',        cat:'Veg',     kcal:25,  protein:1,   carbs:6,  fat:0.2, unit:'g' },
  { id:'capsicum',      name:'Capsicum',                 cat:'Veg',     kcal:20,  protein:0.9, carbs:4.6,fat:0.2, unit:'g' },
  { id:'bottle_gourd',  name:'Lauki / Bottle Gourd',     cat:'Veg',     kcal:14,  protein:0.6, carbs:3.4,fat:0.0, unit:'g' },
  { id:'cucumber',      name:'Cucumber',                 cat:'Veg',     kcal:15,  protein:0.7, carbs:3.6,fat:0.1, unit:'g' },
  { id:'mushroom',      name:'Mushroom',                 cat:'Veg',     kcal:22,  protein:3.1, carbs:3.3,fat:0.3, unit:'g' },

  // ── Fats & Oils ──────────────────────────────────────────────
  { id:'ghee',          name:'Ghee',                     cat:'Fat',     kcal:900, protein:0,   carbs:0,  fat:100, unit:'g' },
  { id:'oil',           name:'Cooking Oil',              cat:'Fat',     kcal:884, protein:0,   carbs:0,  fat:100, unit:'g' },
  { id:'butter',        name:'Butter',                   cat:'Fat',     kcal:717, protein:0.9, carbs:0.1,fat:81,  unit:'g' },
  { id:'peanut_butter', name:'Peanut Butter',            cat:'Fat',     kcal:588, protein:25,  carbs:20, fat:50,  unit:'g' },
  { id:'almonds',       name:'Almonds',                  cat:'Fat',     kcal:579, protein:21,  carbs:22, fat:50,  unit:'g' },
  { id:'cashew',        name:'Cashew',                   cat:'Fat',     kcal:553, protein:18,  carbs:30, fat:44,  unit:'g' },
  { id:'walnut',        name:'Walnut',                   cat:'Fat',     kcal:654, protein:15,  carbs:14, fat:65,  unit:'g' },
  { id:'peanuts',       name:'Peanuts',                  cat:'Fat',     kcal:567, protein:26,  carbs:16, fat:49,  unit:'g' },
  { id:'flax_seeds',    name:'Flax Seeds',               cat:'Fat',     kcal:534, protein:18,  carbs:29, fat:42,  unit:'g' },
  { id:'chia_seeds',    name:'Chia Seeds',               cat:'Fat',     kcal:486, protein:17,  carbs:42, fat:31,  unit:'g' },
  { id:'coconut',       name:'Fresh Coconut',            cat:'Fat',     kcal:354, protein:3.3, carbs:15, fat:33,  unit:'g' },

  // ── Fruits (values per 100g) ─────────────────────────────────
  { id:'banana',        name:'Banana',                   cat:'Fruit',   kcal:89,  protein:1.1, carbs:23, fat:0.3, unit:'piece', perUnit:118 },
  { id:'apple',         name:'Apple',                    cat:'Fruit',   kcal:52,  protein:0.3, carbs:14, fat:0.2, unit:'piece', perUnit:180 },
  { id:'mango',         name:'Mango',                    cat:'Fruit',   kcal:60,  protein:0.8, carbs:15, fat:0.4, unit:'g' },
  { id:'orange',        name:'Orange',                   cat:'Fruit',   kcal:47,  protein:0.9, carbs:12, fat:0.1, unit:'piece', perUnit:130 },
  { id:'papaya',        name:'Papaya',                   cat:'Fruit',   kcal:43,  protein:0.5, carbs:11, fat:0.3, unit:'g' },
  { id:'guava',         name:'Guava',                    cat:'Fruit',   kcal:68,  protein:2.6, carbs:14, fat:1,   unit:'piece', perUnit:100 },
  { id:'dates',         name:'Dates',                    cat:'Fruit',   kcal:277, protein:1.8, carbs:75, fat:0.2, unit:'piece', perUnit:8 },

  // ── Misc / Condiments ────────────────────────────────────────
  { id:'sugar',         name:'Sugar',                    cat:'Misc',    kcal:387, protein:0,   carbs:100,fat:0,   unit:'g' },
  { id:'jaggery',       name:'Jaggery / Gur',            cat:'Misc',    kcal:383, protein:0.4, carbs:98, fat:0.1, unit:'g' },
  { id:'honey',         name:'Honey',                    cat:'Misc',    kcal:304, protein:0.3, carbs:82, fat:0,   unit:'g' },
  { id:'coconut_milk',  name:'Coconut Milk',             cat:'Misc',    kcal:230, protein:2.3, carbs:6,  fat:24,  unit:'ml' },
]

export const FOOD_CATS = ['Dal','Grain','Bread','Protein','Veg','Fat','Fruit','Misc']

/* Compute macros for a given food + amount.
   amount is in the food's unit (grams, or count of pieces/scoops). */
export function computeFoodMacros(food, amount) {
  const grams = (food.unit === 'g' || food.unit === 'ml')
    ? amount
    : amount * (food.perUnit || 100)
  const factor = grams / 100
  return {
    cals:    Math.round(food.kcal * factor),
    protein: Math.round(food.protein * factor * 10) / 10,
    carbs:   Math.round(food.carbs * factor * 10) / 10,
    fat:     Math.round(food.fat * factor * 10) / 10,
    grams:   Math.round(grams),
  }
}
