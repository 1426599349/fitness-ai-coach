def calculate_metrics(height_cm: float, weight_kg: float, age: int, gender: str, 
                       fitness_goal: str, activity_level: str = "moderate") -> dict:
    bmi = weight_kg / ((height_cm/100) ** 2)
    if gender == 'male':
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
    
    activity_factors = {"sedentary":1.2, "light":1.375, "moderate":1.55, "active":1.725, "very_active":1.9}
    tdee = bmr * activity_factors.get(activity_level, 1.55)
    
    if fitness_goal == "fat_loss":
        recommended = tdee - 400
    elif fitness_goal == "muscle_gain":
        recommended = tdee + 250
    else:
        recommended = tdee
    
    protein = weight_kg * 1.6  # 通用
    fat = recommended * 0.25 / 9
    carb = (recommended - protein*4 - fat*9) / 4
    
    return {
        "bmi": round(bmi,1),
        "bmr": round(bmr),
        "tdee": round(tdee),
        "recommended_intake": round(recommended),
        "protein_g": round(protein),
        "fat_g": round(fat),
        "carb_g": round(carb)
    }