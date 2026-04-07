import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';

type UserPositionDoc = Partial<UserPositionInterface> & { _id: string; toObject: () => any };
type UserActivityDoc = Partial<UserActivityInterface> & {
    _id: string;
    toObject: () => any;
    save: () => Promise<void>;
};

// Global in-memory stores grouped by wallet address
const positionStores: Record<string, UserPositionDoc[]> = {};
const activityStores: Record<string, UserActivityDoc[]> = {};

const getUserPositionModel = (walletAddress: string) => {
    if (!positionStores[walletAddress]) {
        positionStores[walletAddress] = [];
    }
    const store = positionStores[walletAddress];

    return {
        find(query?: any) {
            return {
                exec: async () => {
                    return [...store];
                },
            };
        },
        async findOneAndUpdate(query: any, update: any, options: any) {
            let doc = store.find(
                (item) => item.asset === query.asset && item.conditionId === query.conditionId
            );
            if (doc) {
                Object.assign(doc, update);
            } else if (options?.upsert) {
                doc = {
                    _id: Math.random().toString(),
                    ...update,
                    toObject: function () {
                        return { ...this };
                    },
                } as UserPositionDoc;
                store.push(doc);
            }
            return doc;
        },
    };
};

const getUserActivityModel = (walletAddress: string) => {
    if (!activityStores[walletAddress]) {
        activityStores[walletAddress] = [];
    }
    const store = activityStores[walletAddress];

    return Object.assign(
        function UserActivityConstructor(data: any) {
            const instance = {
                _id: Math.random().toString(),
                ...data,
                toObject: function () {
                    return { ...this };
                },
                save: async () => {
                    store.push(instance as UserActivityDoc);
                },
            };
            return instance;
        },
        {
            async countDocuments() {
                return store.length;
            },
            findOne(query: any) {
                return {
                    exec: async () => {
                        return store.find((item) => item.transactionHash === query.transactionHash) || null;
                    },
                };
            },
            find(query: any) {
                return {
                    exec: async () => {
                        let results = store;
                        if (query && query.$and) {
                            const conditions = query.$and;
                            results = results.filter((item) => {
                                return conditions.every((cond: any) => {
                                    if (cond.type) return item.type === cond.type;
                                    if (cond.bot !== undefined) return item.bot === cond.bot;
                                    if (cond.botExcutedTime !== undefined)
                                        return item.botExcutedTime === cond.botExcutedTime;
                                    return true;
                                });
                            });
                        }
                        return results.map((item) => ({ ...item }));
                    },
                };
            },
            async updateMany(filter: any, update: any) {
                let count = 0;
                store.forEach((item) => {
                    if (filter.bot !== undefined && item.bot !== filter.bot) return;
                    if (update.$set) {
                        Object.assign(item, update.$set);
                        count++;
                    }
                });
                return { modifiedCount: count };
            },
            updateOne(filter: any, update: any) {
                return {
                    exec: async () => {
                        const item = store.find((i) => i._id === filter._id);
                        if (item) {
                            if (update.$set) {
                                Object.assign(item, update.$set);
                            } else {
                                Object.assign(item, update);
                            }
                        }
                        return { modifiedCount: item ? 1 : 0 };
                    },
                };
            },
        }
    );
};

export { getUserActivityModel, getUserPositionModel };
