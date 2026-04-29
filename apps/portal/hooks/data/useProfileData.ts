import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../api/query-keys";
import { fetchUserDetail } from "../../services/UserService";

type UseProfileDataOptions = {
  userId?: string;
};

export function useProfileData(options: UseProfileDataOptions) {
  const userId = options.userId;

  const profileQuery = useQuery({
    queryKey: queryKeys.myProfile.detail(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) {
        throw new Error("Missing user session");
      }
      return fetchUserDetail(userId);
    },
  });

  return {
    profileQuery,
  };
}
