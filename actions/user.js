"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { generateAIInsights } from "./dashboard";

// export async function updateUser(data) {
//   const { userId } = await auth();
//   if (!userId) throw new Error("Unauthorized");

//   const user = await db.user.findUnique({
//     where: { clerkUserId: userId },
//   });

//   if (!user) throw new Error("User not found");

//   try {
//     // Start a transaction to handle both operations
//     const result = await db.$transaction(
//       async (tx) => {
//         // First check if industry exists
//         let industryInsight = await tx.industryInsight.findUnique({
//           where: {
//             industry: data.industry,
//           },
//         });

//         // If industry doesn't exist, create it with default values
//         // ... inside transaction
//         if (!industryInsight) {
//           const insights = await generateAIInsights(data.industry);

//           industryInsight = await tx.industryInsight.create({ // <--- CORRECTED
//             data: {
//               industry: data.industry,
//               ...insights,
//               nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
//             },
//           });
//         }
// // ...
//         // Now update the user
//         const updatedUser = await tx.user.update({
//           where: {
//             id: user.id,
//           },
//           data: {
//             industry: data.industry,
//             experience: data.experience,
//             bio: data.bio,
//             skills: data.skills,
//           },
//         });

//         return { updatedUser, industryInsight };
//       },
//       {
//         timeout: 10000, // default: 5000
//       }
//     );

//     revalidatePath("/");
//     return result.user;
//   } catch (error) {
//     console.error("Error updating user and industry:", error.message);
//     throw new Error("Failed to update profile");
//   }
// }

export async function updateUser(data) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  let insights; // Will hold the AI insights if we need them

  try {
    // --- STEP 1: Perform slow operations OUTSIDE the transaction ---

    // First, check if the industry data already exists in our DB
    const existingIndustryInsight = await db.industryInsight.findUnique({
      where: {
        industry: data.industry,
      },
    });

    // If it DOES NOT exist, call the slow AI API to generate it.
    if (!existingIndustryInsight) {
      // This is the slow network call that was causing the timeout.
      insights = await generateAIInsights(data.industry);
    }

    // --- STEP 2: Perform fast, database-only operations INSIDE the transaction ---
    
    // Now that the slow work is done, start the fast transaction.
    const result = await db.$transaction(
      async (tx) => {
        
        let industryInsight;

        // Re-check for industry inside the transaction to prevent race conditions
        industryInsight = await tx.industryInsight.findUnique({
          where: {
            industry: data.industry,
          },
        });

        // If it's still not here AND we generated insights in Step 1, create it.
        if (!industryInsight && insights) {
          industryInsight = await tx.industryInsight.create({
            data: {
              industry: data.industry,
              ...insights, // Use the pre-fetched insights
              nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });
        }

        // Now, update the user. This is a fast operation.
        const updatedUser = await tx.user.update({
          where: {
            id: user.id,
          },
          data: {
            industry: data.industry,
            experience: data.experience,
            bio: data.bio,
            skills: data.skills,
          },
        });

        return { updatedUser, industryInsight };
      },
      {
        timeout: 10000, // The 10s timeout is now more than enough
      }
    );

    revalidatePath("/");
    
    // --- FIX 2: Your original code had a small bug here ---
    // The transaction returns { updatedUser, ... }, not { user, ... }
    return result.updatedUser;

  } catch (error) {
    // Log the *original* error to see if it's from the AI or DB
    console.error("Error updating user and industry:", error.message);
    throw new Error("Failed to update profile");
  }
}

export async function getUserOnboardingStatus() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    const user = await db.user.findUnique({
      where: {
        clerkUserId: userId,
      },
      select: {
        industry: true,
      },
    });

    return {
      isOnboarded: !!user?.industry,
    };
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    throw new Error("Failed to check onboarding status");
  }
}
