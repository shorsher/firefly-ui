// Copyright © 2021 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  Box,
  CircularProgress,
  Grid,
  TablePagination,
  Typography,
} from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import dayjs from 'dayjs';
import React, { useContext, useEffect, useState } from 'react';
import { useHistory } from 'react-router';
import { DataTable } from '../../../../core/components/DataTable/DataTable';
import { DataTableEmptyState } from '../../../../core/components/DataTable/DataTableEmptyState';
import { HashPopover } from '../../../../core/components/HashPopover';
import { ApplicationContext } from '../../../../core/contexts/ApplicationContext';
import { NamespaceContext } from '../../../../core/contexts/NamespaceContext';
import {
  IDataTableRecord,
  IPagedTokenAccountResponse,
  ITokenAccount,
  ITokenAccountWithPools,
  ITokenBalance,
  ITokenPool,
} from '../../../../core/interfaces';
import { fetchWithCredentials } from '../../../../core/utils';
import { useTokensTranslation } from '../../registration';

const PAGE_LIMITS = [10, 25];
const MAX_BALANCE_QUERY = 25;
const MAX_POOLS_SHOWN = 3;

export const Accounts: () => JSX.Element = () => {
  const history = useHistory();
  const classes = useStyles();
  const { t } = useTokensTranslation();
  const [loading, setLoading] = useState(false);
  const [transfersUpdated, setTransfersUpdated] = useState(0);
  const [tokenAccounts, setTokenAccounts] = useState<ITokenAccountWithPools[]>(
    []
  );
  const [tokenAccountsTotal, setTokenAccountsTotal] = useState(0);
  const { selectedNamespace } = useContext(NamespaceContext);
  const { lastEvent } = useContext(ApplicationContext);
  const [currentPage, setCurrentPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_LIMITS[0]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    if (
      newPage > currentPage &&
      rowsPerPage * (currentPage + 1) >= tokenAccountsTotal
    ) {
      return;
    }
    setCurrentPage(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setCurrentPage(0);
    setRowsPerPage(+event.target.value);
  };

  const pagination = (
    <TablePagination
      component="div"
      count={-1}
      rowsPerPage={rowsPerPage}
      page={currentPage}
      onPageChange={handleChangePage}
      onRowsPerPageChange={handleChangeRowsPerPage}
      rowsPerPageOptions={PAGE_LIMITS}
      labelDisplayedRows={({ from, to }) => `${from} - ${to}`}
      className={classes.pagination}
    />
  );

  useEffect(() => {
    if (lastEvent && lastEvent.data) {
      const eventJson = JSON.parse(lastEvent.data);
      if (eventJson.type === 'token_transfer_confirmed') {
        setTransfersUpdated(new Date().getTime());
      }
    }
  }, [lastEvent]);

  useEffect(() => {
    setLoading(true);
    fetchWithCredentials(
      `/api/v1/namespaces/${selectedNamespace}/tokens/accounts?limit=${rowsPerPage}&skip=${
        rowsPerPage * currentPage
      }&count&sort=key`
    )
      .then(async (tokenAccountsResponse) => {
        if (tokenAccountsResponse.ok) {
          const tokenAccounts: IPagedTokenAccountResponse =
            await tokenAccountsResponse.json();
          setTokenAccountsTotal(tokenAccounts.total);
          setTokenAccounts(
            await fetchAccountDetails(selectedNamespace, tokenAccounts.items)
          );
        } else {
          console.log('error fetching token accounts');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [rowsPerPage, currentPage, selectedNamespace, transfersUpdated]);

  const tokenAccountsColumnHeaders = [
    t('address'),
    t('pools'),
    t('lastUpdated'),
  ];

  const tokenAccountsRecords: IDataTableRecord[] = tokenAccounts?.map(
    (tokenAccount: ITokenAccountWithPools, idx: number) => ({
      key: idx.toString(),
      columns: [
        {
          value: <HashPopover textColor="primary" address={tokenAccount.key} />,
        },
        {
          value: tokenAccount.pools,
        },
        {
          value: tokenAccount.updated,
        },
      ],
      onClick: () => {
        history.push(
          `/namespace/${selectedNamespace}/tokens/accounts/${tokenAccount.key}`
        );
      },
    })
  );

  if (loading) {
    return (
      <Box className={classes.centeredContent}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <Grid container justifyContent="center">
        <Grid container wrap="nowrap" direction="column">
          <Grid container item direction="row">
            <Grid className={classes.headerContainer} item>
              <Typography variant="h4" className={classes.header}>
                {t('accounts')}
              </Typography>
            </Grid>
            <Box className={classes.separator} />
          </Grid>
          <Grid container item>
            {tokenAccounts?.length ? (
              <DataTable
                stickyHeader={true}
                minHeight="300px"
                maxHeight="calc(100vh - 340px)"
                columnHeaders={tokenAccountsColumnHeaders}
                records={tokenAccountsRecords}
                {...{ pagination }}
              />
            ) : (
              <DataTableEmptyState
                message={t('noTokenAccountsToDisplay')}
              ></DataTableEmptyState>
            )}
          </Grid>
        </Grid>
      </Grid>
    </>
  );
};

const fetchAccountDetails = async (
  namespace: string,
  accounts: ITokenAccount[]
): Promise<ITokenAccountWithPools[]> => {
  const result: ITokenAccountWithPools[] = [];
  for (const account of accounts) {
    const balanceResponse = await fetchWithCredentials(
      `/api/v1/namespaces/${namespace}/tokens/balances?limit=${
        MAX_BALANCE_QUERY + 1
      }&sort=-updated`
    );
    if (!balanceResponse.ok) {
      console.log(`error fetching token balances for account ${account.key}`);
      continue;
    }
    const balances: ITokenBalance[] = await balanceResponse.json();
    if (balances.length === 0) {
      continue;
    }

    const poolIds = new Set(balances.map((b) => b.pool));
    const hasMore =
      poolIds.size > MAX_POOLS_SHOWN || balances.length > MAX_BALANCE_QUERY;
    const pools = await fetchPoolDetails(
      namespace,
      Array.from(poolIds).slice(0, MAX_POOLS_SHOWN)
    );
    result.push({
      key: account.key,
      pools: pools.map((p) => p.name).join(', ') + (hasMore ? '...' : ''),
      updated: dayjs(balances[0].updated).format('MM/DD/YYYY h:mm A'),
    });
  }
  return result;
};

const fetchPoolDetails = async (
  namespace: string,
  poolIds: string[]
): Promise<ITokenPool[]> => {
  const result: ITokenPool[] = [];
  for (const id of poolIds) {
    const response = await fetchWithCredentials(
      `/api/v1/namespaces/${namespace}/tokens/pools/${id}`
    );
    if (response.ok) {
      result.push(await response.json());
    } else {
      console.log(`error fetching token pool ${id}`);
    }
  }
  return result;
};

const useStyles = makeStyles((theme) => ({
  centeredContent: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: 'calc(100vh - 300px)',
    overflow: 'auto',
  },
  header: {
    fontWeight: 'bold',
  },
  headerContainer: {
    marginBottom: theme.spacing(5),
  },
  pagination: {
    color: theme.palette.text.secondary,
  },
  separator: {
    flexGrow: 1,
  },
}));
